-- Type Sprint, Market Detective and the Coin shop. Apply after 0001 to 0004.
--
-- The shop sells cosmetics (skins, sounds) and one convenience bonus (a stamina refill).
-- Everything is paid for with Coins, the in-game currency. Coins are never real money and
-- are not redeemable. Nothing sold here changes how a run is scored or how many Airdrop
-- Points it earns: items must not turn the airdrop into pay-to-win.
--
-- NOT YET RUN against Postgres. Run supabase/tests/shop_checks.sql after it.

-- ---------------------------------------------------------------------------
-- New games
-- ---------------------------------------------------------------------------

alter table public.game_sessions drop constraint game_sessions_game_check;
alter table public.game_sessions add constraint game_sessions_game_check
  check (game in ('beat_lanes', 'card_clash', 'type_sprint', 'market_detective'));

-- ---------------------------------------------------------------------------
-- Shop
-- ---------------------------------------------------------------------------

create table public.shop_items (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null,
  category    text not null check (category in ('skin', 'sound', 'bonus')),
  game        text not null check (game in ('beat_lanes', 'card_clash', 'type_sprint', 'market_detective', 'all')),
  price_coins int  not null check (price_coins > 0),
  -- What equipping or using the item does. Public: the client uses it to draw the skin.
  effect      jsonb not null default '{}'::jsonb,
  consumable  boolean not null default false,
  min_level   int  not null default 1 check (min_level >= 1),
  active      boolean not null default true,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table public.player_items (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  item_id     uuid not null references public.shop_items (id) on delete cascade,
  quantity    int  not null default 1 check (quantity >= 0),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- One equipped skin and one equipped sound pack per game.
create table public.player_equipped (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  game     text not null,
  category text not null check (category in ('skin', 'sound')),
  item_id  uuid not null references public.shop_items (id) on delete cascade,
  primary key (user_id, game, category)
);

alter table public.shop_items      enable row level security;
alter table public.player_items    enable row level security;
alter table public.player_equipped enable row level security;
revoke all on public.shop_items, public.player_items, public.player_equipped from anon, authenticated;
grant select on public.shop_items, public.player_items, public.player_equipped to authenticated;
create policy items_read    on public.shop_items      for select to authenticated using (active);
create policy owned_read    on public.player_items    for select to authenticated using (user_id = auth.uid());
create policy equipped_read on public.player_equipped for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Trusted operations (service role only)
-- ---------------------------------------------------------------------------

-- Spends Coins and records the item. The debit is a negative ledger row and the balance
-- changes in the same transaction, so reconcile_balances() stays at zero. p_request is a
-- client-generated id: a retried request is recognised and never charges twice.
create function public.purchase_item(p_user uuid, p_item uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i       public.shop_items%rowtype;
  v_xp    bigint;
  v_coins bigint;
  v_key   text := 'buy:' || p_request::text;
  v_ver   text;
begin
  select * into i from public.shop_items where id = p_item and active;
  if not found then raise exception 'unknown_item'; end if;

  select xp, coins into v_xp, v_coins from public.player_balances where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  if exists (select 1 from public.points_ledger where user_id = p_user and idempotency_key = v_key) then
    return jsonb_build_object('duplicate', true);
  end if;
  if public.level_for_xp(v_xp) < i.min_level then
    return jsonb_build_object('error', 'locked', 'required_level', i.min_level);
  end if;
  if not i.consumable and exists (select 1 from public.player_items where user_id = p_user and item_id = i.id) then
    return jsonb_build_object('error', 'already_owned');
  end if;
  if v_coins < i.price_coins then
    return jsonb_build_object('error', 'not_enough_coins', 'coins', v_coins, 'price', i.price_coins);
  end if;

  select version into v_ver from public.rules_versions where active;
  insert into public.points_ledger (user_id, balance_type, amount, reason, source_type, source_id, idempotency_key, rules_version)
  values (p_user, 'coins', -i.price_coins, 'purchase:' || i.slug, 'shop', i.id, v_key, v_ver);
  update public.player_balances set coins = coins - i.price_coins, updated_at = now() where user_id = p_user;

  insert into public.player_items (user_id, item_id, quantity) values (p_user, i.id, 1)
  on conflict (user_id, item_id) do update set quantity = public.player_items.quantity + 1;
  return jsonb_build_object('ok', true, 'coins', v_coins - i.price_coins);
end $$;

-- Equips an owned skin or sound pack (or unequips it when p_on is false).
create function public.equip_item(p_user uuid, p_item uuid, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i public.shop_items%rowtype;
begin
  select * into i from public.shop_items where id = p_item and active and category in ('skin', 'sound');
  if not found then raise exception 'unknown_item'; end if;
  if not exists (select 1 from public.player_items where user_id = p_user and item_id = i.id and quantity > 0) then
    return jsonb_build_object('error', 'not_owned');
  end if;
  if p_on then
    insert into public.player_equipped (user_id, game, category, item_id) values (p_user, i.game, i.category, i.id)
    on conflict (user_id, game, category) do update set item_id = excluded.item_id;
  else
    delete from public.player_equipped where user_id = p_user and game = i.game and category = i.category and item_id = i.id;
  end if;
  return jsonb_build_object('ok', true, 'equipped', p_on);
end $$;

-- Uses one consumable. Only the stamina refill exists: it tops stamina up, capped.
create function public.use_item(p_user uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i      public.shop_items%rowtype;
  v_cap  int;
  v_new  int;
  v_left int;
begin
  select * into i from public.shop_items where id = p_item and active and category = 'bonus';
  if not found then raise exception 'unknown_item'; end if;
  if i.effect ->> 'type' <> 'stamina' then raise exception 'unsupported_bonus'; end if;

  perform 1 from public.player_stamina where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  update public.player_items set quantity = quantity - 1
   where user_id = p_user and item_id = i.id and quantity > 0
  returning quantity into v_left;
  if not found then return jsonb_build_object('error', 'none_left'); end if;

  select coalesce((config ->> 'stamina_cap')::int, 10) into v_cap from public.rules_versions where active;
  update public.player_stamina
     set stamina = least(v_cap, stamina + coalesce((i.effect ->> 'amount')::int, 0))
   where user_id = p_user
  returning stamina into v_new;
  return jsonb_build_object('ok', true, 'stamina', v_new, 'left', v_left);
end $$;

revoke all on function public.purchase_item(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.equip_item(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.use_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purchase_item(uuid, uuid, uuid) to service_role;
grant execute on function public.equip_item(uuid, uuid, boolean) to service_role;
grant execute on function public.use_item(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Catalogue. Every price is a placeholder to tune.
-- ---------------------------------------------------------------------------

insert into public.shop_items (slug, name, description, category, game, price_coins, effect, consumable, min_level, sort_order) values
  ('bl-neon',   'Neon Night',    'Electric greens, blues and magentas for the Beat Lanes tiles.',           'skin',  'beat_lanes', 300, '{"palette": [{"light":"#B8FFE6","mid":"#2DE3A8","dark":"#0E8F66","rgb":"45,227,168"},{"light":"#C9B8FF","mid":"#7C6CFF","dark":"#4B3BD0","rgb":"124,108,255"},{"light":"#FFB8E6","mid":"#FF3DB8","dark":"#B0147E","rgb":"255,61,184"},{"light":"#FFF3B0","mid":"#FFD23F","dark":"#C79A00","rgb":"255,210,63"}]}', false, 1, 10),
  ('bl-sunset', 'Sunset',        'Warm ambers, corals and plums for the Beat Lanes tiles.',                 'skin',  'beat_lanes', 400, '{"palette": [{"light":"#FFD0A8","mid":"#FF8A3D","dark":"#C2500B","rgb":"255,138,61"},{"light":"#FFB3B3","mid":"#FF5A5A","dark":"#B52222","rgb":"255,90,90"},{"light":"#E8B8FF","mid":"#B054E8","dark":"#6D1FA3","rgb":"176,84,232"},{"light":"#FFE9A8","mid":"#FFC233","dark":"#C48A00","rgb":"255,194,51"}]}', false, 2, 11),
  ('bl-marimba','Marimba notes',  'A warm, woody voice for every tile you tap.',                              'sound', 'beat_lanes', 250, '{"timbre": "marimba"}', false, 1, 12),
  ('bl-synth',  'Synth notes',   'Bright, buzzy synth tones for every tile you tap.',                        'sound', 'beat_lanes', 250, '{"timbre": "synth"}', false, 1, 13),
  ('cc-emerald','Emerald backs', 'Deep green card backs with gold trim.',                                    'skin',  'card_clash', 300, '{"back": "emerald"}', false, 2, 20),
  ('cc-obsidian','Obsidian backs','Near-black card backs with silver trim.',                                 'skin',  'card_clash', 350, '{"back": "obsidian"}', false, 2, 21),
  ('cc-chimes', 'Crystal chimes','Glassy chimes for flips and matches.',                                      'sound', 'card_clash', 200, '{"set": "chimes"}', false, 2, 22),
  ('ts-amber',  'Amber terminal','Warm amber text on a dark console.',                                       'skin',  'type_sprint',250, '{"theme": "amber"}', false, 3, 30),
  ('ts-ice',    'Ice console',   'Cool cyan text on a deep blue console.',                                   'skin',  'type_sprint',300, '{"theme": "ice"}', false, 3, 31),
  ('ts-mech',   'Mechanical keys','Crisp, clicky keystrokes.',                                               'sound', 'type_sprint',200, '{"keys": "mechanical"}', false, 3, 32),
  ('ts-soft',   'Soft keys',     'Quiet, rounded keystrokes.',                                               'sound', 'type_sprint',200, '{"keys": "soft"}', false, 3, 33),
  ('md-slate',  'Slate desk',    'A muted slate-grey analyst desk.',                                         'skin',  'market_detective', 300, '{"theme": "slate"}', false, 4, 40),
  ('md-gold',   'Gold desk',     'A dark desk with gold chart lines.',                                       'skin',  'market_detective', 350, '{"theme": "gold"}', false, 4, 41),
  ('stamina-refill', 'Stamina refill', 'Adds 5 stamina so you can play more runs now. Daily reward limits still apply.', 'bonus', 'all', 150, '{"type": "stamina", "amount": 5}', true, 1, 50);
