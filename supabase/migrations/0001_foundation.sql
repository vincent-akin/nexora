-- Nexora foundation (PRD v0.1, week 1 and the server side of week 2)
--
-- Players, rules, level config, the append-only points ledger, balances,
-- stamina, game sessions and scores, with RLS on everything.
--
-- Trust model: clients can only READ their own rows. Every write goes through
-- the security-definer functions at the bottom, which are executable by the
-- service role only. The Next.js server calls them after validating a run with
-- lib/beat-lanes/core.ts. A browser can never mint a reward.
--
-- NOT YET RUN: this file has not been executed against Postgres. Apply it to a
-- Supabase branch or local project first and run the checks in the README.

-- ---------------------------------------------------------------------------
-- Rules and level configuration (data, not code)
-- ---------------------------------------------------------------------------

create table public.rules_versions (
  version    text primary key,
  config     jsonb not null,
  active     boolean not null default false,
  created_at timestamptz not null default now()
);
-- At most one active rules version.
create unique index rules_versions_one_active on public.rules_versions (active) where active;

create table public.level_config (
  level       int primary key check (level >= 1),
  name        text not null,
  xp_required bigint not null check (xp_required >= 0),
  unlocks     jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text not null check (display_name ~ '^[A-Za-z0-9_]{3,20}$'),
  referral_code  text not null unique,
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index profiles_display_name_ci on public.profiles (lower(display_name));

create table public.player_balances (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  xp             bigint not null default 0 check (xp >= 0),
  coins          bigint not null default 0 check (coins >= 0),
  airdrop_points bigint not null default 0 check (airdrop_points >= 0),
  updated_at     timestamptz not null default now()
);

create table public.player_stamina (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  stamina    int not null check (stamina >= 0),
  -- Start of the current refill interval. Always "now" while stamina is at the cap.
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ledger (append-only) and game data
-- ---------------------------------------------------------------------------

create table public.points_ledger (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  balance_type    text not null check (balance_type in ('xp', 'coins', 'airdrop_points')),
  amount          bigint not null check (amount <> 0),
  reason          text not null,
  source_type     text not null,
  source_id       uuid,
  idempotency_key text not null,
  rules_version   text not null references public.rules_versions (version),
  created_at      timestamptz not null default now()
);
-- One grant event can write up to three rows (one per balance), never two of the same kind.
create unique index points_ledger_idem on public.points_ledger (user_id, idempotency_key, balance_type);
create index points_ledger_user_day on public.points_ledger (user_id, balance_type, source_type, created_at);

create table public.game_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  game            text not null check (game in ('beat_lanes', 'card_clash')),
  difficulty      text check (difficulty in ('easy', 'normal', 'hard')),
  seed            bigint not null,
  content_version text not null,
  status          text not null default 'started' check (status in ('started', 'submitted', 'rejected', 'expired')),
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  submitted_at    timestamptz
);
create index game_sessions_user on public.game_sessions (user_id, started_at desc);

create table public.game_scores (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.game_sessions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  game       text not null,
  difficulty text,
  score      int not null check (score >= 0),
  accuracy   numeric(5, 4) not null check (accuracy between 0 and 1),
  max_combo  int not null check (max_combo >= 0),
  verdict    text not null check (verdict in ('accepted', 'flagged')),
  flags      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index game_scores_board on public.game_scores (game, difficulty, score desc, created_at asc)
  where verdict = 'accepted';

-- Internal only: no client policies, so RLS denies everything to clients.
create table public.risk_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  reviewed   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.admin_audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  target     text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- The ledger is append-only. Corrections are new rows with a reason.
create function public.ledger_is_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'points_ledger is append-only';
end $$;

create trigger points_ledger_no_update before update or delete on public.points_ledger
  for each row execute function public.ledger_is_append_only();

-- Every new auth user gets a profile, a referral code, balances and full stamina.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cap  int;
  v_code text;
  v_try  int := 0;
begin
  select coalesce((config ->> 'stamina_cap')::int, 10) into v_cap
    from public.rules_versions where active;
  v_cap := coalesce(v_cap, 10);

  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.profiles (id, display_name, referral_code)
      values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 6), v_code);
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  insert into public.player_balances (user_id) values (new.id);
  insert into public.player_stamina (user_id, stamina) values (new.id, v_cap);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security: clients read their own data, write nothing directly
-- ---------------------------------------------------------------------------

alter table public.rules_versions   enable row level security;
alter table public.level_config     enable row level security;
alter table public.profiles         enable row level security;
alter table public.player_balances  enable row level security;
alter table public.player_stamina   enable row level security;
alter table public.points_ledger    enable row level security;
alter table public.game_sessions    enable row level security;
alter table public.game_scores      enable row level security;
alter table public.risk_flags       enable row level security;
alter table public.admin_audit_logs enable row level security;

-- Start from nothing, then grant the minimum.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.rules_versions, public.level_config to authenticated;
create policy rules_read on public.rules_versions for select to authenticated using (active);
create policy levels_read on public.level_config for select to authenticated using (true);

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

grant select on public.player_balances, public.player_stamina, public.points_ledger,
                public.game_sessions, public.game_scores to authenticated;
create policy balances_read_own on public.player_balances for select to authenticated using (user_id = auth.uid());
create policy stamina_read_own  on public.player_stamina  for select to authenticated using (user_id = auth.uid());
create policy ledger_read_own   on public.points_ledger   for select to authenticated using (user_id = auth.uid());
create policy sessions_read_own on public.game_sessions   for select to authenticated using (user_id = auth.uid());
create policy scores_read_own   on public.game_scores     for select to authenticated using (user_id = auth.uid());
-- risk_flags and admin_audit_logs: RLS on, no policies, no grants. Server only.

-- Public leaderboard: display names and best accepted scores only. The view
-- runs with its owner's rights on purpose, so it can show other players' rows
-- without exposing emails, ids or anything else.
create view public.leaderboard_best as
  select distinct on (s.user_id, s.game, s.difficulty)
    p.display_name, s.game, s.difficulty, s.score as best_score, s.created_at as achieved_at
  from public.game_scores s
  join public.profiles p on p.id = s.user_id
  where s.verdict = 'accepted' and p.account_status = 'active'
  order by s.user_id, s.game, s.difficulty, s.score desc, s.created_at asc;
grant select on public.leaderboard_best to authenticated;

-- ---------------------------------------------------------------------------
-- Trusted operations (service role only)
-- ---------------------------------------------------------------------------

create function public.level_for_xp(p_xp bigint) returns int
language sql stable set search_path = '' as $$
  select coalesce(max(level), 1) from public.level_config where xp_required <= p_xp;
$$;
grant execute on function public.level_for_xp(bigint) to authenticated;

-- Credits XP / Coins / Airdrop Points. Idempotent per (user, idempotency key).
-- Game-run credits are clamped to the daily caps in the active rules (UTC day).
create function public.grant_reward(
  p_user uuid, p_xp bigint, p_coins bigint, p_points bigint,
  p_reason text, p_source_type text, p_source_id uuid, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_version   text;
  v_rules     jsonb;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_amounts   jsonb := '{}'::jsonb;
  v_type      text;
  v_req       bigint;
  v_used      bigint;
  v_cap       bigint;
  v_grant     bigint;
begin
  if least(p_xp, p_coins, p_points) < 0 then
    raise exception 'negative_grant_not_allowed';
  end if;

  perform 1 from public.player_balances where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  if exists (select 1 from public.points_ledger where user_id = p_user and idempotency_key = p_idempotency_key) then
    return jsonb_build_object('duplicate', true);
  end if;

  select version, config into v_version, v_rules from public.rules_versions where active;
  if v_version is null then raise exception 'no_active_rules'; end if;

  foreach v_type in array array['xp', 'coins', 'airdrop_points'] loop
    v_req := case v_type when 'xp' then p_xp when 'coins' then p_coins else p_points end;
    v_grant := v_req;
    if p_source_type = 'game_run' then
      v_cap := (v_rules -> 'daily_caps' ->> v_type)::bigint;
      select coalesce(sum(amount), 0) into v_used
        from public.points_ledger
       where user_id = p_user and balance_type = v_type
         and source_type = 'game_run' and created_at >= v_day_start;
      v_grant := least(v_req, greatest(coalesce(v_cap, v_req) - v_used, 0));
    end if;
    if v_grant > 0 then
      insert into public.points_ledger
        (user_id, balance_type, amount, reason, source_type, source_id, idempotency_key, rules_version)
      values (p_user, v_type, v_grant, p_reason, p_source_type, p_source_id, p_idempotency_key, v_version);
      v_amounts := v_amounts || jsonb_build_object(v_type, v_grant);
    end if;
  end loop;

  update public.player_balances set
    xp             = xp + coalesce((v_amounts ->> 'xp')::bigint, 0),
    coins          = coins + coalesce((v_amounts ->> 'coins')::bigint, 0),
    airdrop_points = airdrop_points + coalesce((v_amounts ->> 'airdrop_points')::bigint, 0),
    updated_at     = now()
  where user_id = p_user;

  return jsonb_build_object('duplicate', false, 'granted', v_amounts, 'rules_version', v_version);
end $$;

-- Spends stamina (refilling lazily from stored timestamps) and opens a session.
create function public.start_game_run(
  p_user uuid, p_game text, p_difficulty text, p_seed bigint, p_content_version text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rules  jsonb;
  v_cap    int;
  v_refill int;
  v_cost   int;
  v_ttl    int;
  s        public.player_stamina%rowtype;
  v_gained int;
  v_cur    int;
  v_since  timestamptz;
  v_id     uuid;
  v_exp    timestamptz;
begin
  select config into v_rules from public.rules_versions where active;
  if v_rules is null then raise exception 'no_active_rules'; end if;
  v_cap    := coalesce((v_rules ->> 'stamina_cap')::int, 10);
  v_refill := coalesce((v_rules ->> 'stamina_refill_seconds')::int, 1200);
  v_cost   := coalesce((v_rules ->> 'run_stamina_cost')::int, 1);
  v_ttl    := coalesce((v_rules ->> 'session_ttl_seconds')::int, 300);

  select * into s from public.player_stamina where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  v_gained := floor(extract(epoch from (now() - s.updated_at)) / v_refill)::int;
  if s.stamina + v_gained >= v_cap then
    v_cur := v_cap;
    v_since := now();
  else
    v_cur := s.stamina + v_gained;
    v_since := s.updated_at + make_interval(secs => v_gained * v_refill);
  end if;

  if v_cur < v_cost then
    -- Persist the refill we computed and report it. This returns instead of
    -- raising, because an exception would roll the refill back.
    update public.player_stamina set stamina = v_cur, updated_at = v_since where user_id = p_user;
    return jsonb_build_object(
      'error', 'insufficient_stamina',
      'stamina', v_cur,
      'seconds_until_next', greatest(0, ceil(v_refill - extract(epoch from (now() - v_since))))::int
    );
  end if;

  update public.player_stamina set stamina = v_cur - v_cost, updated_at = v_since where user_id = p_user;

  v_exp := now() + make_interval(secs => v_ttl);
  insert into public.game_sessions (user_id, game, difficulty, seed, content_version, expires_at)
  values (p_user, p_game, p_difficulty, p_seed, p_content_version, v_exp)
  returning id into v_id;

  return jsonb_build_object('session_id', v_id, 'expires_at', v_exp, 'stamina', v_cur - v_cost);
end $$;

-- Closes a session exactly once, stores the validated score and pays out.
-- All amounts come from the server, computed by core.ts rewardFor().
create function public.settle_game_run(
  p_session uuid, p_user uuid, p_score int, p_accuracy numeric, p_max_combo int,
  p_verdict text, p_flags jsonb, p_xp bigint, p_coins bigint, p_points bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sess  public.game_sessions%rowtype;
  v_grant jsonb;
begin
  if p_verdict not in ('accepted', 'flagged') then raise exception 'bad_verdict'; end if;

  update public.game_sessions set status = 'submitted', submitted_at = now()
   where id = p_session and user_id = p_user and status = 'started' and expires_at > now()
  returning * into v_sess;
  if not found then raise exception 'session_not_open'; end if;

  insert into public.game_scores (session_id, user_id, game, difficulty, score, accuracy, max_combo, verdict, flags)
  values (p_session, p_user, v_sess.game, v_sess.difficulty, p_score, p_accuracy, p_max_combo, p_verdict, p_flags);

  if p_verdict = 'flagged' then
    insert into public.risk_flags (user_id, kind, detail)
    values (p_user, 'run_flagged', jsonb_build_object('session_id', p_session, 'flags', p_flags));
  end if;

  v_grant := public.grant_reward(p_user, p_xp, p_coins, p_points, 'game_run', 'game_run', p_session, 'run:' || p_session::text);
  return jsonb_build_object('score', p_score, 'verdict', p_verdict, 'grant', v_grant);
end $$;

-- Records a submission that failed validation. The session and its stamina are spent.
create function public.reject_game_run(p_session uuid, p_user uuid, p_reasons jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.game_sessions set status = 'rejected', submitted_at = now()
   where id = p_session and user_id = p_user and status = 'started';
  if not found then raise exception 'session_not_open'; end if;
  insert into public.risk_flags (user_id, kind, detail)
  values (p_user, 'run_rejected', jsonb_build_object('session_id', p_session, 'reasons', p_reasons));
end $$;

-- Rows returned here are balances that do not equal the sum of their ledger entries.
-- Expected result: zero rows. Run it on a schedule and alert on any output.
create function public.reconcile_balances()
returns table (user_id uuid, balance_type text, balance bigint, ledger_sum bigint)
language sql stable security definer set search_path = '' as $$
  with b as (
    select pb.user_id as uid, 'xp'::text as bt, pb.xp as bal from public.player_balances pb
    union all select pb.user_id, 'coins', pb.coins from public.player_balances pb
    union all select pb.user_id, 'airdrop_points', pb.airdrop_points from public.player_balances pb
  ), l as (
    select pl.user_id as uid, pl.balance_type as bt, sum(pl.amount)::bigint as s
      from public.points_ledger pl group by pl.user_id, pl.balance_type
  )
  select b.uid, b.bt, b.bal, coalesce(l.s, 0)::bigint
    from b left join l on l.uid = b.uid and l.bt = b.bt
   where b.bal <> coalesce(l.s, 0);
$$;

-- Only the service role may call the trusted operations.
revoke all on function public.grant_reward(uuid, bigint, bigint, bigint, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.start_game_run(uuid, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.settle_game_run(uuid, uuid, int, numeric, int, text, jsonb, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.reject_game_run(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_balances() from public, anon, authenticated;
grant execute on function public.grant_reward(uuid, bigint, bigint, bigint, text, text, uuid, text) to service_role;
grant execute on function public.start_game_run(uuid, text, text, bigint, text) to service_role;
grant execute on function public.settle_game_run(uuid, uuid, int, numeric, int, text, jsonb, bigint, bigint, bigint) to service_role;
grant execute on function public.reject_game_run(uuid, uuid, jsonb) to service_role;
grant execute on function public.reconcile_balances() to service_role;

-- ---------------------------------------------------------------------------
-- Seed data (placeholders: tune after play-testing)
-- ---------------------------------------------------------------------------

insert into public.rules_versions (version, active, config) values (
  'v0.1', true,
  '{
     "stamina_cap": 10,
     "stamina_refill_seconds": 1200,
     "run_stamina_cost": 1,
     "session_ttl_seconds": 300,
     "daily_caps": { "xp": 500, "coins": 300, "airdrop_points": 20 }
   }'::jsonb
);

insert into public.level_config (level, name, xp_required, unlocks) values
  (1, 'The Rookie',     0,    '["beat_lanes:easy", "beat_lanes:normal"]'),
  (2, 'The Builder',    100,  '["card_clash", "studio_preview"]'),
  (3, 'The Explorer',   400,  '["beat_lanes:hard"]'),
  (4, 'The Strategist', 1000, '[]'),
  (5, 'The Legend',     2500, '[]');
