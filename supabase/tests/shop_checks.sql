-- Checks for 0005_shop_and_games.sql. Run after all five migrations. Rolls back; "ALL CHECKS PASSED" means success.
-- NOT YET RUN against Postgres.

begin;

do $$
declare
  u      uuid := '00000000-0000-0000-0000-0000000000f1';
  r      jsonb;
  skin   uuid; snd uuid; hi uuid; refill uuid;
  req1   uuid := gen_random_uuid();
  failed boolean;
begin
  insert into auth.users (id, email) values (u, 'shop@example.com');
  select id into skin   from public.shop_items where slug = 'bl-neon';
  select id into snd    from public.shop_items where slug = 'bl-marimba';
  select id into hi     from public.shop_items where slug = 'md-gold';      -- needs level 4
  select id into refill from public.shop_items where slug = 'stamina-refill';

  -- 1. The new games can open sessions.
  assert (public.start_game_run(u, 'type_sprint', 'normal', 1, 'v1') ->> 'session_id') is not null, 'check 1a: type_sprint session';
  assert (public.start_game_run(u, 'market_detective', 'normal', 1, 'v1') ->> 'session_id') is not null, 'check 1b: market_detective session';

  -- 2. Cannot buy without Coins; level locks apply.
  r := public.purchase_item(u, skin, gen_random_uuid());
  assert r ->> 'error' = 'not_enough_coins', 'check 2a: no coins, no purchase';
  perform public.grant_reward(u, 0, 1000, 0, 'test', 'test', null, 'seed-coins');
  r := public.purchase_item(u, hi, gen_random_uuid());
  assert r ->> 'error' = 'locked', 'check 2b: a level-4 item is locked at level 1';

  -- 3. A purchase debits once, even when the request is retried.
  r := public.purchase_item(u, skin, req1);
  assert (r ->> 'ok')::boolean, 'check 3a: purchase works';
  assert (select coins from public.player_balances where user_id = u) = 700, 'check 3b: 300 Coins spent';
  r := public.purchase_item(u, skin, req1);
  assert (r ->> 'duplicate')::boolean, 'check 3c: a retried request is recognised';
  assert (select coins from public.player_balances where user_id = u) = 700, 'check 3d: no double charge';
  r := public.purchase_item(u, skin, gen_random_uuid());
  assert r ->> 'error' = 'already_owned', 'check 3e: a skin can only be bought once';
  assert (select count(*) from public.reconcile_balances()) = 0, 'check 3f: balances still reconcile with the ledger';

  -- 4. Equipping: only owned items, one per game and category.
  r := public.equip_item(u, snd);
  assert r ->> 'error' = 'not_owned', 'check 4a: cannot equip what you do not own';
  r := public.equip_item(u, skin);
  assert (r ->> 'ok')::boolean, 'check 4b: equip an owned skin';
  assert (select count(*) from public.player_equipped where user_id = u) = 1, 'check 4c: equipped';
  perform public.equip_item(u, skin, false);
  assert (select count(*) from public.player_equipped where user_id = u) = 0, 'check 4d: unequipped';

  -- 5. Consumables: buy, use, capped at the stamina limit, none left afterwards.
  r := public.use_item(u, refill);
  assert r ->> 'error' = 'none_left', 'check 5a: nothing to use yet';
  perform public.purchase_item(u, refill, gen_random_uuid());
  update public.player_stamina set stamina = 2 where user_id = u;
  r := public.use_item(u, refill);
  assert (r ->> 'stamina')::int = 7 and (r ->> 'left')::int = 0, 'check 5b: +5 stamina, none left';
  perform public.purchase_item(u, refill, gen_random_uuid());
  r := public.use_item(u, refill);
  assert (r ->> 'stamina')::int = 10, 'check 5c: stamina is capped';
  assert (select count(*) from public.reconcile_balances()) = 0, 'check 5d: still reconciled';

  -- 6. Clients can read the catalogue and their own items, but cannot buy or equip directly.
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.shop_items) >= 13, 'check 6a: catalogue readable';
  assert (select count(*) from public.player_items) >= 1, 'check 6b: own items readable';
  failed := false;
  begin perform public.purchase_item(u, skin, gen_random_uuid());
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6c: clients cannot call purchase_item';
  failed := false;
  begin insert into public.player_items (user_id, item_id) values (u, snd);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6d: clients cannot give themselves items';
  failed := false;
  begin update public.player_balances set coins = 999999 where user_id = u;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6e: clients cannot edit balances';
  reset role;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
