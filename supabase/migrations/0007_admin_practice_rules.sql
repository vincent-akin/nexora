-- Admin practice mode and editable rules. Apply after 0006.
--
--   1. Practice runs: an admin can open any game at any level with any boost and no stamina cost,
--      to test the game. A practice run pays nothing, never counts toward analytics, never moves a
--      level ladder and never appears on the leaderboard. The database enforces all of that, so a
--      bug in the app cannot turn an admin test into airdrop points.
--   2. Rules: the economy settings (stamina, session length, daily reward caps) become versioned
--      rows. Publishing creates a new version and switches to it in one step; an old version can be
--      switched back to. Every reward in the ledger already records which version paid it.
--
-- Run supabase/tests/admin_checks.sql after it.

alter table public.game_sessions add column practice boolean not null default false;
alter table public.game_scores   add column practice boolean not null default false;

-- Analytics reads these, so practice never skews the numbers.
create view public.game_scores_real   as select * from public.game_scores   where not practice;
create view public.game_sessions_real as select * from public.game_sessions where not practice;
revoke all on public.game_scores_real, public.game_sessions_real from anon, authenticated;

create or replace view public.leaderboard_best as
  select distinct on (s.user_id, s.game, s.difficulty)
    p.display_name, s.game, s.difficulty, s.score as best_score, s.created_at as achieved_at
  from public.game_scores s
  join public.profiles p on p.id = s.user_id
  where s.verdict = 'accepted' and not s.boosted and not s.practice and p.account_status = 'active'
  order by s.user_id, s.game, s.difficulty, s.score desc, s.created_at asc;

-- Same signature as 0006. A practice run settles with no reward at all.
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

  if jsonb_array_length(v_sess.boosts) > 0 then v_points := 0; end if;

  insert into public.game_scores (session_id, user_id, game, difficulty, score, accuracy, max_combo, verdict, flags, level, boosted, practice)
  values (p_session, p_user, v_sess.game, v_sess.difficulty, p_score, p_accuracy, p_max_combo, p_verdict, p_flags,
          v_sess.level, jsonb_array_length(v_sess.boosts) > 0 or v_sess.practice, v_sess.practice);

  if v_sess.practice then
    return jsonb_build_object('score', p_score, 'verdict', p_verdict, 'practice', true, 'grant', jsonb_build_object('granted', '{}'::jsonb));
  end if;

  if p_verdict = 'flagged' then
    insert into public.risk_flags (user_id, kind, detail)
    values (p_user, 'run_flagged', jsonb_build_object('session_id', p_session, 'flags', p_flags));
  end if;

  v_grant := public.grant_reward(p_user, p_xp, p_coins, v_points, 'game_run', 'game_run', p_session, 'run:' || p_session::text);
  return jsonb_build_object('score', p_score, 'verdict', p_verdict, 'grant', v_grant);
end $$;

-- begin_level_run gains p_practice. The old signature is dropped so the name stays unambiguous.
drop function public.begin_level_run(uuid, text, text, int, bigint, text, text[], int);

create function public.begin_level_run(
  p_user uuid, p_game text, p_difficulty text, p_level int, p_seed bigint,
  p_content_version text, p_boosts text[], p_max_level int, p_practice boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_unlocked int;
  v_start    jsonb;
  v_sid      uuid;
  v_kind     text;
  v_item     uuid;
  v_applied  text[] := '{}';
  v_ttl      int;
  v_exp      timestamptz;
begin
  if p_level < 1 or p_level > p_max_level then return jsonb_build_object('error', 'bad_level'); end if;
  if coalesce(array_length(p_boosts, 1), 0) > 2 then return jsonb_build_object('error', 'too_many_boosts'); end if;
  if exists (select 1 from public.profiles where id = p_user and account_status <> 'active') then
    return jsonb_build_object('error', 'account_suspended');
  end if;

  if p_practice then
    if not exists (select 1 from public.admin_users where user_id = p_user) then return jsonb_build_object('error', 'not_admin'); end if;
    foreach v_kind in array coalesce(p_boosts, '{}') loop
      if v_kind = any (v_applied) then raise exception 'duplicate_boost'; end if;
      perform 1 from public.shop_items where game = p_game and category = 'bonus' and effect ->> 'type' = 'boost' and effect ->> 'kind' = v_kind;
      if not found then raise exception 'unknown_boost'; end if;
      v_applied := v_applied || v_kind;
    end loop;
    select coalesce((config ->> 'session_ttl_seconds')::int, 300) into v_ttl from public.rules_versions where active;
    v_exp := now() + make_interval(secs => coalesce(v_ttl, 300));
    insert into public.game_sessions (user_id, game, difficulty, seed, content_version, expires_at, level, boosts, practice)
    values (p_user, p_game, p_difficulty, p_seed, p_content_version, v_exp, p_level, to_jsonb(v_applied), true)
    returning id into v_sid;
    return jsonb_build_object('session_id', v_sid, 'expires_at', v_exp, 'stamina', (select stamina from public.player_stamina where user_id = p_user),
                              'level', p_level, 'boosts', to_jsonb(v_applied), 'practice', true);
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

revoke all on function public.begin_level_run(uuid, text, text, int, bigint, text, text[], int, boolean) from public, anon, authenticated;
grant execute on function public.begin_level_run(uuid, text, text, int, bigint, text, text[], int, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

alter table public.rules_versions add column note text, add column created_by uuid;

-- Checks a rules config. The limits protect the game: a session must outlast the longest run (150 s),
-- and a daily cap of zero would silently stop all rewards of that kind.
create function public.check_rules(p_config jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  v_caps jsonb := p_config -> 'daily_caps';
begin
  if jsonb_typeof(p_config) <> 'object' then raise exception 'bad_rules: not an object'; end if;
  if (p_config ->> 'stamina_cap')::int not between 1 and 100 then raise exception 'bad_rules: stamina_cap must be 1 to 100'; end if;
  if (p_config ->> 'stamina_refill_seconds')::int not between 60 and 86400 then raise exception 'bad_rules: stamina_refill_seconds must be 60 to 86400'; end if;
  if (p_config ->> 'run_stamina_cost')::int not between 1 and 10 then raise exception 'bad_rules: run_stamina_cost must be 1 to 10'; end if;
  if (p_config ->> 'session_ttl_seconds')::int not between 240 and 900 then raise exception 'bad_rules: session_ttl_seconds must be 240 to 900'; end if;
  if v_caps is null or jsonb_typeof(v_caps) <> 'object' then raise exception 'bad_rules: daily_caps missing'; end if;
  if (v_caps ->> 'xp')::int not between 1 and 1000000 then raise exception 'bad_rules: daily xp cap must be 1 to 1000000'; end if;
  if (v_caps ->> 'coins')::int not between 1 and 1000000 then raise exception 'bad_rules: daily coins cap must be 1 to 1000000'; end if;
  if (v_caps ->> 'airdrop_points')::int not between 1 and 10000 then raise exception 'bad_rules: daily airdrop_points cap must be 1 to 10000'; end if;
exception when invalid_text_representation or null_value_not_allowed then
  raise exception 'bad_rules: every value must be a whole number';
end $$;

-- Publishes a new rules version and makes it the active one.
create function public.publish_rules(p_config jsonb, p_actor uuid, p_note text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_version text := 'v' || to_char(now() at time zone 'utc', 'YYYYMMDD-HH24MISS');
begin
  perform public.check_rules(p_config);
  update public.rules_versions set active = false where active;
  insert into public.rules_versions (version, config, active, note, created_by) values (v_version, p_config, true, left(p_note, 200), p_actor);
  return v_version;
end $$;

-- Switches back to an earlier version.
create function public.activate_rules(p_version text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_cfg jsonb;
begin
  select config into v_cfg from public.rules_versions where version = p_version;
  if v_cfg is null then raise exception 'unknown_version'; end if;
  perform public.check_rules(v_cfg);
  update public.rules_versions set active = false where active;
  update public.rules_versions set active = true where version = p_version;
end $$;

revoke all on function public.check_rules(jsonb), public.publish_rules(jsonb, uuid, text), public.activate_rules(text) from public, anon, authenticated;
grant execute on function public.check_rules(jsonb), public.publish_rules(jsonb, uuid, text), public.activate_rules(text) to service_role;

-- ---------------------------------------------------------------------------
-- Analytics: the same function as 0006, reading the views that leave practice out
-- ---------------------------------------------------------------------------

create or replace function public.admin_analytics(p_days int default 14) returns jsonb
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
    'active_24h',        (select count(distinct user_id) from public.game_sessions_real where started_at > now() - interval '24 hours'),
    'active_7d',         (select count(distinct user_id) from public.game_sessions_real where started_at > now() - interval '7 days'),
    'runs_total',        (select count(*) from public.game_scores_real),
    'runs_24h',          (select count(*) from public.game_scores_real where created_at > now() - interval '24 hours'),
    'runs_flagged_7d',   (select count(*) from public.game_scores_real where verdict = 'flagged' and created_at > now() - interval '7 days'),
    'runs_rejected_7d',  (select count(*) from public.game_sessions_real where status = 'rejected' and started_at > now() - interval '7 days'),
    'boosted_runs_7d',   (select count(*) from public.game_scores_real where boosted and created_at > now() - interval '7 days'),
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
          from public.game_scores_real where created_at >= v_since group by game
      ) g), '[]'::jsonb),
    'per_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'runs', coalesce(r.runs, 0), 'players', coalesce(r.players, 0), 'signups', coalesce(s.signups, 0)) order by d.day)
      from (select generate_series(v_since::date, now()::date, interval '1 day')::date as day) d
      left join (select created_at::date as day, count(*) as runs, count(distinct user_id) as players from public.game_scores_real group by 1) r on r.day = d.day
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


