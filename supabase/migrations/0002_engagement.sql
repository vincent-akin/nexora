-- Nexora engagement layer (PRD sections 7, 9, 10, 14): daily rewards and
-- streaks, missions, referrals and admin users.
--
-- Same trust model as 0001: clients read their own rows, every write goes
-- through a service-role-only security-definer function.
--
-- NOT YET RUN against Postgres. Apply 0001 first, then this file, then run
-- supabase/tests/engagement_checks.sql.

-- ---------------------------------------------------------------------------
-- Tunable values live in the active rules version
-- ---------------------------------------------------------------------------

update public.rules_versions
   set config = config || '{
     "daily_reward":    { "xp": 10, "coins_base": 10, "coins_step": 5, "points_on_day_7": 1 },
     "referral_reward": { "coins": 50, "airdrop_points": 2 }
   }'::jsonb
 where version = 'v0.1';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.daily_claims (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  claim_date date not null,                -- UTC day (campaign timezone, proposed)
  streak     int  not null check (streak >= 1),
  created_at timestamptz not null default now(),
  primary key (user_id, claim_date)
);

create table public.missions (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  description   text not null,
  -- Completion is always decided from validated game_scores, never from a client claim.
  kind          text not null check (kind in ('first_run', 'runs_today', 'score_today')),
  target        int  not null check (target >= 1),
  difficulty    text check (difficulty in ('easy', 'normal', 'hard')),
  daily         boolean not null default false,
  reward_xp     int  not null default 0 check (reward_xp >= 0),
  reward_coins  int  not null default 0 check (reward_coins >= 0),
  reward_points int  not null default 0 check (reward_points >= 0),
  active        boolean not null default true,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

create table public.mission_claims (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  mission_id uuid not null references public.missions (id) on delete cascade,
  claim_key  text not null,                -- 'once' or the UTC date for daily missions
  created_at timestamptz not null default now(),
  unique (user_id, mission_id, claim_key)
);

create table public.referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  referred_id uuid not null unique references public.profiles (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  check (referrer_id <> referred_id)
);
create index referrals_referrer on public.referrals (referrer_id, status);

create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.daily_claims   enable row level security;
alter table public.missions       enable row level security;
alter table public.mission_claims enable row level security;
alter table public.referrals      enable row level security;
alter table public.admin_users    enable row level security;

revoke all on public.daily_claims, public.missions, public.mission_claims,
              public.referrals, public.admin_users from anon, authenticated;

grant select on public.daily_claims, public.mission_claims to authenticated;
create policy daily_read_own on public.daily_claims   for select to authenticated using (user_id = auth.uid());
create policy mclaims_read_own on public.mission_claims for select to authenticated using (user_id = auth.uid());

grant select on public.missions to authenticated;
create policy missions_read on public.missions for select to authenticated using (active);

-- Referrers see status and dates only, never who the referred account is.
grant select (id, status, created_at, approved_at) on public.referrals to authenticated;
create policy referrals_read_as_referrer on public.referrals for select to authenticated
  using (referrer_id = auth.uid());
-- admin_users: RLS on, no policies, no grants. Server only.

-- ---------------------------------------------------------------------------
-- Trusted operations (service role only)
-- ---------------------------------------------------------------------------

-- One claim per UTC day. Consecutive days build a streak (caps at day 7 for
-- the bonus); a missed day resets it to 1. Reads no client clock.
create function public.claim_daily(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today  date := (now() at time zone 'utc')::date;
  v_prev   public.daily_claims%rowtype;
  v_streak int;
  v_cfg    jsonb;
  v_xp     bigint;
  v_coins  bigint;
  v_points bigint;
  v_grant  jsonb;
begin
  -- Serialise claims per player on the balances row.
  perform 1 from public.player_balances where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  if exists (select 1 from public.daily_claims where user_id = p_user and claim_date = v_today) then
    return jsonb_build_object('already_claimed', true);
  end if;

  select * into v_prev from public.daily_claims where user_id = p_user and claim_date = v_today - 1;
  v_streak := case when found then v_prev.streak + 1 else 1 end;

  select config -> 'daily_reward' into v_cfg from public.rules_versions where active;
  v_xp     := coalesce((v_cfg ->> 'xp')::bigint, 10);
  v_coins  := coalesce((v_cfg ->> 'coins_base')::bigint, 10)
              + coalesce((v_cfg ->> 'coins_step')::bigint, 5) * (least(v_streak, 7) - 1);
  v_points := case when v_streak % 7 = 0 then coalesce((v_cfg ->> 'points_on_day_7')::bigint, 1) else 0 end;

  insert into public.daily_claims (user_id, claim_date, streak) values (p_user, v_today, v_streak);
  v_grant := public.grant_reward(p_user, v_xp, v_coins, v_points, 'daily_claim', 'daily', null, 'daily:' || v_today::text);
  return jsonb_build_object('already_claimed', false, 'streak', v_streak, 'grant', v_grant);
end $$;

-- Claims a mission if, and only if, validated game results satisfy it.
create function public.claim_mission(p_user uuid, p_mission uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m         public.missions%rowtype;
  v_today   date := (now() at time zone 'utc')::date;
  v_day     timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_key     text;
  v_count   int;
  v_ok      boolean;
  v_grant   jsonb;
begin
  select * into m from public.missions where id = p_mission and active;
  if not found then raise exception 'unknown_mission'; end if;

  perform 1 from public.player_balances where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  v_key := case when m.daily then v_today::text else 'once' end;
  if exists (select 1 from public.mission_claims where user_id = p_user and mission_id = m.id and claim_key = v_key) then
    return jsonb_build_object('already_claimed', true);
  end if;

  if m.kind = 'first_run' then
    select count(*) into v_count from public.game_scores
     where user_id = p_user and verdict = 'accepted' and (m.difficulty is null or difficulty = m.difficulty);
    v_ok := v_count >= m.target;
  elsif m.kind = 'runs_today' then
    select count(*) into v_count from public.game_scores
     where user_id = p_user and verdict in ('accepted', 'flagged') and created_at >= v_day
       and (m.difficulty is null or difficulty = m.difficulty);
    v_ok := v_count >= m.target;
  else -- score_today: flagged runs never count towards score missions
    select exists (
      select 1 from public.game_scores
       where user_id = p_user and verdict = 'accepted' and created_at >= v_day
         and score >= m.target and (m.difficulty is null or difficulty = m.difficulty)
    ) into v_ok;
  end if;

  if not v_ok then
    return jsonb_build_object('completed', false);
  end if;

  insert into public.mission_claims (user_id, mission_id, claim_key) values (p_user, m.id, v_key);
  v_grant := public.grant_reward(
    p_user, m.reward_xp, m.reward_coins, m.reward_points,
    'mission:' || m.slug, 'mission', m.id, 'mission:' || m.id::text || ':' || v_key
  );
  return jsonb_build_object('completed', true, 'already_claimed', false, 'grant', v_grant);
end $$;

-- Records a pending referral. Rejects self-referrals, unknown codes, repeat
-- referrals and accounts older than seven days (late attribution is abuse-prone).
create function public.apply_referral(p_referred uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_referrer uuid;
  v_created  timestamptz;
begin
  select id into v_referrer from public.profiles where referral_code = upper(trim(p_code));
  if v_referrer is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if v_referrer = p_referred then return jsonb_build_object('ok', false, 'reason', 'self_referral'); end if;

  select created_at into v_created from public.profiles where id = p_referred;
  if v_created is null then raise exception 'unknown_player'; end if;
  if v_created < now() - interval '7 days' then return jsonb_build_object('ok', false, 'reason', 'account_too_old'); end if;

  insert into public.referrals (referrer_id, referred_id) values (v_referrer, p_referred)
  on conflict (referred_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already_referred'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- A pending referral is approved once the referred player has a verified email
-- and one accepted game run. Safe to call after every settled run: idempotent.
create function public.qualify_referral(p_referred uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       public.referrals%rowtype;
  v_cfg   jsonb;
  v_grant jsonb;
begin
  select * into r from public.referrals where referred_id = p_referred and status = 'pending' for update;
  if not found then return jsonb_build_object('changed', false); end if;

  if not exists (select 1 from auth.users where id = p_referred and email_confirmed_at is not null) then
    return jsonb_build_object('changed', false, 'reason', 'email_not_verified');
  end if;
  if not exists (select 1 from public.game_scores where user_id = p_referred and verdict = 'accepted') then
    return jsonb_build_object('changed', false, 'reason', 'no_validated_run');
  end if;

  update public.referrals set status = 'approved', approved_at = now() where id = r.id;
  select config -> 'referral_reward' into v_cfg from public.rules_versions where active;
  v_grant := public.grant_reward(
    r.referrer_id, 0,
    coalesce((v_cfg ->> 'coins')::bigint, 50),
    coalesce((v_cfg ->> 'airdrop_points')::bigint, 2),
    'referral_approved', 'referral', r.id, 'referral:' || r.id::text
  );
  return jsonb_build_object('changed', true, 'grant', v_grant);
end $$;

revoke all on function public.claim_daily(uuid) from public, anon, authenticated;
revoke all on function public.claim_mission(uuid, uuid) from public, anon, authenticated;
revoke all on function public.apply_referral(uuid, text) from public, anon, authenticated;
revoke all on function public.qualify_referral(uuid) from public, anon, authenticated;
grant execute on function public.claim_daily(uuid) to service_role;
grant execute on function public.claim_mission(uuid, uuid) to service_role;
grant execute on function public.apply_referral(uuid, text) to service_role;
grant execute on function public.qualify_referral(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Seed missions (placeholders)
-- ---------------------------------------------------------------------------

insert into public.missions (slug, title, description, kind, target, difficulty, daily, reward_xp, reward_coins, reward_points, sort_order) values
  ('first-run',   'Play your first run',     'Finish one Beat Lanes run on any difficulty.',      'first_run',   1,    null,     false, 20, 20, 1, 1),
  ('runs-3',      'Play 3 runs today',       'Finish three Beat Lanes runs today.',               'runs_today',  3,    null,     true,  15, 15, 0, 2),
  ('score-5000',  'Score 5,000 on Normal',   'Reach 5,000 points in one Normal run today.',       'score_today', 5000, 'normal', true,  25, 20, 1, 3);
