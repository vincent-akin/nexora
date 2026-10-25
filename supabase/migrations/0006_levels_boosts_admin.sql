-- Game levels, purchasable boosts, Block Drop (replaces Card Clash), admin analytics.
-- Apply after 0001 to 0005.
--
--   1. Every game has a ladder of levels. A player may start any level up to the highest they
--      have unlocked (player_game_levels). The server decides when a level unlocks.
--   2. Boosts are consumables sold in the shop, one or two per game. They are spent when a run
--      starts, inside the same transaction that spends stamina, so a failed start costs nothing.
--      A run that used a boost earns XP and Coins but never Airdrop Points, and its score is
--      kept off the leaderboard (see settle_game_run and the leaderboard view below).
--   3. Block Drop is a new game id. Card Clash rows stay in the database as history.
--   4. admin_analytics() feeds the admin dashboard.
--
-- Run supabase/tests/levels_checks.sql after it.

-- ---------------------------------------------------------------------------
-- Games, sessions, scores
-- ---------------------------------------------------------------------------

alter table public.game_sessions drop constraint game_sessions_game_check;
alter table public.game_sessions add constraint game_sessions_game_check
  check (game in ('beat_lanes', 'card_clash', 'type_sprint', 'market_detective', 'block_drop'));

alter table public.game_sessions
  add column level  int   not null default 1 check (level >= 1),
  add column boosts jsonb not null default '[]'::jsonb;
-- Not secret: the player may see which level they chose and which boosts they spent.
grant select (level, boosts) on public.game_sessions to authenticated;

alter table public.game_scores
  add column level   int     not null default 1,
  add column boosted boolean not null default false;

-- Same signature as 0001, so create or replace is enough. The only change: the score row
-- records the level and whether a boost was used.
create or replace function public.settle_game_run(
  p_session uuid, p_user uuid, p_score int, p_accuracy numeric, p_max_combo int,
  p_verdict text, p_flags jsonb, p_xp bigint, p_coins bigint, p_points bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess   public.game_sessions%rowtype;
  v_grant  jsonb;
  v_points bigint := p_points;
begin
  if p_verdict not in ('accepted', 'flagged') then raise exception 'bad_verdict'; end if;

  update public.game_sessions set status = 'submitted', submitted_at = now()
   where id = p_session and user_id = p_user and status = 'started' and expires_at > now()
  returning * into v_sess;
  if not found then raise exception 'session_not_open'; end if;

  -- Boosted runs never earn Airdrop Points, whatever the caller passed.
  if jsonb_array_length(v_sess.boosts) > 0 then v_points := 0; end if;

  insert into public.game_scores (session_id, user_id, game, difficulty, score, accuracy, max_combo, verdict, flags, level, boosted)
  values (p_session, p_user, v_sess.game, v_sess.difficulty, p_score, p_accuracy, p_max_combo, p_verdict, p_flags,
          v_sess.level, jsonb_array_length(v_sess.boosts) > 0);

  if p_verdict = 'flagged' then
    insert into public.risk_flags (user_id, kind, detail)
    values (p_user, 'run_flagged', jsonb_build_object('session_id', p_session, 'flags', p_flags));
  end if;

  v_grant := public.grant_reward(p_user, p_xp, p_coins, v_points, 'game_run', 'game_run', p_session, 'run:' || p_session::text);
  return jsonb_build_object('score', p_score, 'verdict', p_verdict, 'grant', v_grant);
end $$;

-- The public board: best accepted, un-boosted score per player, game and difficulty tier.
create or replace view public.leaderboard_best as
  select distinct on (s.user_id, s.game, s.difficulty)
    p.display_name, s.game, s.difficulty, s.score as best_score, s.created_at as achieved_at
  from public.game_scores s
  join public.profiles p on p.id = s.user_id
  where s.verdict = 'accepted' and not s.boosted and p.account_status = 'active'
  order by s.user_id, s.game, s.difficulty, s.score desc, s.created_at asc;

-- ---------------------------------------------------------------------------
-- Sign-up fix
-- ---------------------------------------------------------------------------

-- 0001 derived the default display name from the first 6 characters of the user id, and its
-- retry loop retried with the same name, so two players whose ids shared those characters made
-- the second sign-up fail. The name now carries 8 random characters, drawn again on each retry.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cap  int;
  v_code text;
  v_name text;
  v_try  int := 0;
begin
  select coalesce((config ->> 'stamina_cap')::int, 10) into v_cap
    from public.rules_versions where active;
  v_cap := coalesce(v_cap, 10);

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    v_name := 'player_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    begin
      insert into public.profiles (id, display_name, referral_code) values (new.id, v_name, v_code);
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 8 then raise; end if;
    end;
  end loop;

  insert into public.player_balances (user_id) values (new.id);
  insert into public.player_stamina (user_id, stamina) values (new.id, v_cap);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Level progress
-- ---------------------------------------------------------------------------

create table public.player_game_levels (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game       text not null check (game in ('beat_lanes', 'type_sprint', 'market_detective', 'block_drop')),
  unlocked   int  not null default 1 check (unlocked >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.player_game_levels enable row level security;
revoke all on public.player_game_levels from anon, authenticated;
grant select on public.player_game_levels to authenticated;
create policy game_levels_read_own on public.player_game_levels for select to authenticated using (user_id = auth.uid());

-- Raises (never lowers) the highest unlocked level. Called by the server after it has
-- validated a run and decided how far the player got.
create function public.unlock_game_level(p_user uuid, p_game text, p_level int, p_max int) returns int
language plpgsql security definer set search_path = '' as $$
declare v_new int;
begin
  insert into public.player_game_levels (user_id, game, unlocked)
  values (p_user, p_game, greatest(1, least(p_level, p_max)))
  on conflict (user_id, game) do update
    set unlocked = greatest(public.player_game_levels.unlocked, least(p_level, p_max)), updated_at = now()
  returning unlocked into v_new;
  return v_new;
end $$;

-- Opens a run at a chosen level with optional boosts. Everything happens in one transaction:
-- if a boost is not owned the whole call raises, and the stamina it spent is rolled back.
create function public.begin_level_run(
  p_user uuid, p_game text, p_difficulty text, p_level int, p_seed bigint,
  p_content_version text, p_boosts text[], p_max_level int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_unlocked int;
  v_start    jsonb;
  v_sid      uuid;
  v_kind     text;
  v_item     uuid;
  v_applied  text[] := '{}';
begin
  if p_level < 1 or p_level > p_max_level then return jsonb_build_object('error', 'bad_level'); end if;
  if coalesce(array_length(p_boosts, 1), 0) > 2 then return jsonb_build_object('error', 'too_many_boosts'); end if;
  if exists (select 1 from public.profiles where id = p_user and account_status <> 'active') then
    return jsonb_build_object('error', 'account_suspended');
  end if;

  select unlocked into v_unlocked from public.player_game_levels where user_id = p_user and game = p_game;
  v_unlocked := coalesce(v_unlocked, 1);
  if p_level > v_unlocked then return jsonb_build_object('error', 'level_locked', 'unlocked', v_unlocked); end if;

  v_start := public.start_game_run(p_user, p_game, p_difficulty, p_seed, p_content_version);
  if v_start ? 'error' then return v_start; end if;
  v_sid := (v_start ->> 'session_id')::uuid;

  foreach v_kind in array coalesce(p_boosts, '{}') loop
    if v_kind = any (v_applied) then raise exception 'duplicate_boost'; end if;
    select id into v_item from public.shop_items
     where game = p_game and category = 'bonus' and active
       and effect ->> 'type' = 'boost' and effect ->> 'kind' = v_kind;
    if v_item is null then raise exception 'unknown_boost'; end if;
    update public.player_items set quantity = quantity - 1
     where user_id = p_user and item_id = v_item and quantity > 0;
    if not found then raise exception 'boost_not_owned'; end if;
    v_applied := v_applied || v_kind;
  end loop;

  update public.game_sessions set level = p_level, boosts = to_jsonb(v_applied) where id = v_sid;
  return v_start || jsonb_build_object('level', p_level, 'boosts', to_jsonb(v_applied));
end $$;

revoke all on function public.unlock_game_level(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.begin_level_run(uuid, text, text, int, bigint, text, text[], int) from public, anon, authenticated;
grant execute on function public.unlock_game_level(uuid, text, int, int) to service_role;
grant execute on function public.begin_level_run(uuid, text, text, int, bigint, text, text[], int) to service_role;

-- ---------------------------------------------------------------------------
-- Shop: Card Clash items move to Block Drop, and every game gets boosts
-- ---------------------------------------------------------------------------

alter table public.shop_items drop constraint shop_items_game_check;
alter table public.shop_items add constraint shop_items_game_check
  check (game in ('beat_lanes', 'card_clash', 'type_sprint', 'market_detective', 'block_drop', 'all'));

-- Owners keep what they bought: rows are updated in place, so item ids do not change.
update public.shop_items set game = 'block_drop', slug = 'bd-emerald',  name = 'Emerald blocks',
  description = 'Cool green and gold block colours with a deep green well.', effect = '{"theme": "emerald"}', min_level = 2
 where slug = 'cc-emerald';
update public.shop_items set game = 'block_drop', slug = 'bd-obsidian', name = 'Obsidian blocks',
  description = 'Smoky dark blocks with silver edges.', effect = '{"theme": "obsidian"}', min_level = 2
 where slug = 'cc-obsidian';
update public.shop_items set game = 'block_drop', slug = 'bd-chimes',   name = 'Crystal chimes',
  description = 'Glassy chimes for moves, locks and line clears.', effect = '{"set": "chimes"}', min_level = 2
 where slug = 'cc-chimes';
update public.player_equipped set game = 'block_drop' where game = 'card_clash';

-- Boosts. kind is what the game's rules look for; see lib/boosts.ts.
insert into public.shop_items (slug, name, description, category, game, price_coins, effect, consumable, min_level, sort_order) values
  ('bl-boost-life',   'Extra hearts',   'Start a Beat Lanes run with 3 extra hearts. A boosted run earns no Airdrop Points.',                       'bonus', 'beat_lanes',       120, '{"type":"boost","kind":"life"}',   true, 1, 60),
  ('bd-boost-slow',   'Slow drop',      'Blocks fall 30% slower for the whole run. A boosted run earns no Airdrop Points.',                          'bonus', 'block_drop',       150, '{"type":"boost","kind":"slow"}',   true, 2, 61),
  ('bd-boost-second', 'Second chance',  'When the stack reaches the top once, the top half is cleared and the run goes on. No Airdrop Points.',      'bonus', 'block_drop',       200, '{"type":"boost","kind":"second"}', true, 2, 62),
  ('ts-boost-life',   'Spare life',     'Start a Type Sprint run with one extra life. A boosted run earns no Airdrop Points.',                       'bonus', 'type_sprint',      120, '{"type":"boost","kind":"life"}',   true, 3, 63),
  ('ts-boost-slow',   'Slow words',     'Words fall 25% slower for the whole run. A boosted run earns no Airdrop Points.',                           'bonus', 'type_sprint',      150, '{"type":"boost","kind":"slow"}',   true, 3, 64),
  ('md-boost-time',   'Extra time',     'Ten extra seconds on every round. A boosted run earns no Airdrop Points.',                                  'bonus', 'market_detective', 120, '{"type":"boost","kind":"time"}',   true, 4, 65),
  ('md-boost-hint',   'Cross out two',  'Two wrong answers are crossed out in every round. A boosted run earns no Airdrop Points.',                  'bonus', 'market_detective', 180, '{"type":"boost","kind":"hint"}',   true, 4, 66);

-- ---------------------------------------------------------------------------
-- Admin analytics (service role only)
-- ---------------------------------------------------------------------------

create function public.admin_analytics(p_days int default 14) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_days  int := greatest(1, least(p_days, 90));
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  out     jsonb;
begin
  select jsonb_build_object(
    'players_total',     (select count(*) from public.profiles),
    'players_new_7d',    (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'players_suspended', (select count(*) from public.profiles where account_status <> 'active'),
    'active_24h',        (select count(distinct user_id) from public.game_sessions where started_at > now() - interval '24 hours'),
    'active_7d',         (select count(distinct user_id) from public.game_sessions where started_at > now() - interval '7 days'),
    'runs_total',        (select count(*) from public.game_scores),
    'runs_24h',          (select count(*) from public.game_scores where created_at > now() - interval '24 hours'),
    'runs_flagged_7d',   (select count(*) from public.game_scores where verdict = 'flagged' and created_at > now() - interval '7 days'),
    'runs_rejected_7d',  (select count(*) from public.game_sessions where status = 'rejected' and started_at > now() - interval '7 days'),
    'boosted_runs_7d',   (select count(*) from public.game_scores where boosted and created_at > now() - interval '7 days'),
    'coins_issued_7d',   (select coalesce(sum(amount), 0) from public.points_ledger where balance_type = 'coins' and amount > 0 and created_at > now() - interval '7 days'),
    'coins_spent_7d',    (select coalesce(-sum(amount), 0) from public.points_ledger where balance_type = 'coins' and amount < 0 and created_at > now() - interval '7 days'),
    'points_issued_7d',  (select coalesce(sum(amount), 0) from public.points_ledger where balance_type = 'airdrop_points' and amount > 0 and created_at > now() - interval '7 days'),
    'points_issued_total', (select coalesce(sum(amount), 0) from public.points_ledger where balance_type = 'airdrop_points' and amount > 0),
    'pending_tweets',    (select count(*) from public.social_submissions where status = 'pending'),
    'pending_flags',     (select count(*) from public.risk_flags where not reviewed),
    'pending_referrals', (select count(*) from public.referrals where status = 'pending'),
    'per_game', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game', g.game, 'runs', g.runs, 'players', g.players, 'avg_score', g.avg_score, 'avg_level', g.avg_level, 'flagged', g.flagged
      ) order by g.runs desc)
      from (
        select game, count(*) as runs, count(distinct user_id) as players,
               round(avg(score))::int as avg_score, round(avg(level), 1) as avg_level,
               count(*) filter (where verdict = 'flagged') as flagged
          from public.game_scores where created_at >= v_since group by game
      ) g), '[]'::jsonb),
    'per_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'runs', coalesce(r.runs, 0), 'players', coalesce(r.players, 0), 'signups', coalesce(s.signups, 0)) order by d.day)
      from (select generate_series(v_since::date, now()::date, interval '1 day')::date as day) d
      left join (select created_at::date as day, count(*) as runs, count(distinct user_id) as players from public.game_scores group by 1) r on r.day = d.day
      left join (select created_at::date as day, count(*) as signups from public.profiles group by 1) s on s.day = d.day
    ), '[]'::jsonb),
    'top_players', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.display_name, 'xp', t.xp, 'coins', t.coins, 'points', t.airdrop_points) order by t.xp desc)
      from (select p.display_name, b.xp, b.coins, b.airdrop_points
              from public.player_balances b join public.profiles p on p.id = b.user_id
             order by b.xp desc limit 8) t), '[]'::jsonb),
    'best_sellers', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'game', x.game, 'sold', x.sold) order by x.sold desc)
      from (select i.name, i.game, count(*) as sold
              from public.points_ledger l join public.shop_items i on i.id = l.source_id
             where l.source_type = 'shop' and l.amount < 0 group by i.name, i.game
             order by sold desc limit 6) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;

revoke all on function public.admin_analytics(int) from public, anon, authenticated;
grant execute on function public.admin_analytics(int) to service_role;
