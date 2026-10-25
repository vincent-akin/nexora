-- Tasks: the RWAINC campaign tasks (PRD section 7). Apply after 0001 to 0003.
--
--   social_x       post about the RWAINC token on X, submit the link, an admin reviews it
--   referrals      refer N friends (counts approved referrals)
--   token_purchase buy a set amount of RWAINC. DISABLED: verifying a purchase needs the token's
--                  chain and contract address, which are not confirmed yet (PRD open questions)
--   stocks_quiz    a question about the RWA stocks platform, answer checked on the server
--
-- Nothing here is verified automatically against X or a blockchain. The tweet task is
-- manual review, and the purchase task cannot be claimed at all until the verification
-- method is decided and built.
--
-- NOT YET RUN against Postgres. Run supabase/tests/task_checks.sql after it.

alter table public.missions
  add column params          jsonb   not null default '{}'::jsonb,
  add column secret_answer   text,
  add column requires_review boolean not null default false,
  add column enabled         boolean not null default true;

alter table public.missions drop constraint missions_kind_check;
alter table public.missions add constraint missions_kind_check check (
  kind in ('first_run', 'runs_today', 'score_today', 'social_x', 'referrals', 'token_purchase', 'stocks_quiz')
);

-- Clients may read missions but never the quiz answer: swap the table-wide SELECT
-- for a column list that leaves secret_answer out.
revoke select on public.missions from authenticated;
grant select (id, slug, title, description, kind, target, difficulty, daily, reward_xp, reward_coins,
              reward_points, active, sort_order, params, requires_review, enabled)
  on public.missions to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.social_submissions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  mission_id  uuid not null references public.missions (id) on delete cascade,
  period_key  text not null,                          -- UTC date for daily tasks, 'once' otherwise
  url         text not null check (char_length(url) <= 300 and url ~* '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]+'),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, mission_id, period_key)
);
-- One tweet can pay out once, across every account. Query strings are ignored and x.com and
-- twitter.com links to the same tweet count as the same link.
create unique index social_submissions_url on public.social_submissions
  (lower(regexp_replace(split_part(url, '?', 1), '^https://(www\.)?(x|twitter)\.com/', '', 'i')));
create index social_submissions_pending on public.social_submissions (status, created_at) where status = 'pending';

-- One wrong answer per quiz per period: stops guessing through the options.
create table public.mission_attempts (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  mission_id uuid not null references public.missions (id) on delete cascade,
  period_key text not null,
  attempts   int  not null default 0,
  primary key (user_id, mission_id, period_key)
);

alter table public.social_submissions enable row level security;
alter table public.mission_attempts   enable row level security;
revoke all on public.social_submissions, public.mission_attempts from anon, authenticated;
grant select on public.social_submissions to authenticated;
create policy social_read_own on public.social_submissions for select to authenticated using (user_id = auth.uid());
-- mission_attempts: RLS on, no policies, no grants. Server only.

-- ---------------------------------------------------------------------------
-- Claiming (replaces the two-argument version from 0002)
-- ---------------------------------------------------------------------------

drop function public.claim_mission(uuid, uuid);

create function public.claim_mission(p_user uuid, p_mission uuid, p_answer text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m         public.missions%rowtype;
  v_today   date := (now() at time zone 'utc')::date;
  v_day     timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_key     text;
  v_count   int;
  v_ok      boolean;
  v_tries   int;
  v_grant   jsonb;
begin
  select * into m from public.missions where id = p_mission and active;
  if not found then raise exception 'unknown_mission'; end if;

  perform 1 from public.player_balances where user_id = p_user for update;
  if not found then raise exception 'unknown_player'; end if;

  v_key := case when m.daily then v_today::text else 'once' end;

  -- Tasks that cannot be claimed here.
  if m.kind = 'social_x' then
    return jsonb_build_object('completed', false, 'reason', 'submit_a_link');
  end if;
  if m.kind = 'token_purchase' or not m.enabled then
    return jsonb_build_object('completed', false, 'disabled', true, 'reason', 'not_available_yet');
  end if;

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
  elsif m.kind = 'score_today' then
    select exists (
      select 1 from public.game_scores
       where user_id = p_user and verdict = 'accepted' and created_at >= v_day
         and score >= m.target and (m.difficulty is null or difficulty = m.difficulty)
    ) into v_ok;
  elsif m.kind = 'referrals' then
    select count(*) into v_count from public.referrals where referrer_id = p_user and status = 'approved';
    v_ok := v_count >= m.target;
  else -- stocks_quiz: the server checks the answer; one wrong answer per period
    if p_answer is null or m.secret_answer is null then
      return jsonb_build_object('completed', false, 'reason', 'answer_required');
    end if;
    select coalesce(attempts, 0) into v_tries from public.mission_attempts
     where user_id = p_user and mission_id = m.id and period_key = v_key;
    if coalesce(v_tries, 0) >= 1 then
      return jsonb_build_object('completed', false, 'locked', true, 'reason', 'one_try_per_period');
    end if;
    v_ok := lower(trim(p_answer)) = lower(trim(m.secret_answer));
    if not v_ok then
      insert into public.mission_attempts (user_id, mission_id, period_key, attempts) values (p_user, m.id, v_key, 1)
      on conflict (user_id, mission_id, period_key) do update set attempts = public.mission_attempts.attempts + 1;
      return jsonb_build_object('completed', false, 'wrong_answer', true);
    end if;
  end if;

  if not v_ok then
    return jsonb_build_object('completed', false, 'progress', coalesce(v_count, 0), 'target', m.target);
  end if;

  insert into public.mission_claims (user_id, mission_id, claim_key) values (p_user, m.id, v_key);
  v_grant := public.grant_reward(
    p_user, m.reward_xp, m.reward_coins, m.reward_points,
    'mission:' || m.slug, 'mission', m.id, 'mission:' || m.id::text || ':' || v_key
  );
  return jsonb_build_object('completed', true, 'already_claimed', false, 'grant', v_grant);
end $$;

-- ---------------------------------------------------------------------------
-- Manual review for social tasks
-- ---------------------------------------------------------------------------

create function public.submit_social_task(p_user uuid, p_mission uuid, p_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m     public.missions%rowtype;
  s     public.social_submissions%rowtype;
  v_key text;
begin
  select * into m from public.missions where id = p_mission and active and enabled and kind = 'social_x';
  if not found then raise exception 'unknown_mission'; end if;
  v_key := case when m.daily then ((now() at time zone 'utc')::date)::text else 'once' end;

  begin
    select * into s from public.social_submissions where user_id = p_user and mission_id = p_mission and period_key = v_key for update;
    if found then
      if s.status <> 'rejected' then
        return jsonb_build_object('status', s.status, 'already_submitted', true);
      end if;
      -- A rejected link may be replaced with a new one.
      update public.social_submissions
         set url = trim(p_url), status = 'pending', review_note = null, reviewed_by = null, reviewed_at = null, created_at = now()
       where id = s.id;
      return jsonb_build_object('status', 'pending', 'resubmitted', true);
    end if;
    insert into public.social_submissions (user_id, mission_id, period_key, url) values (p_user, p_mission, v_key, trim(p_url));
  exception
    when unique_violation then return jsonb_build_object('error', 'url_already_used');
    when check_violation  then return jsonb_build_object('error', 'invalid_url');
  end;
  return jsonb_build_object('status', 'pending');
end $$;

-- Approving pays out once (the ledger key is the submission id). Rejecting pays nothing.
create function public.review_social_submission(p_id uuid, p_approve boolean, p_actor uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s       public.social_submissions%rowtype;
  m       public.missions%rowtype;
  v_grant jsonb;
begin
  select * into s from public.social_submissions where id = p_id for update;
  if not found then raise exception 'unknown_submission'; end if;
  if s.status <> 'pending' then return jsonb_build_object('error', 'already_reviewed'); end if;
  select * into m from public.missions where id = s.mission_id;

  update public.social_submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = p_note, reviewed_by = p_actor, reviewed_at = now()
   where id = s.id;

  if p_approve then
    v_grant := public.grant_reward(
      s.user_id, m.reward_xp, m.reward_coins, m.reward_points,
      'mission:' || m.slug, 'mission', m.id, 'social:' || s.id::text
    );
  end if;
  insert into public.admin_audit_logs (actor_id, action, target, detail)
  values (p_actor, case when p_approve then 'social_approved' else 'social_rejected' end, s.id::text,
          jsonb_build_object('mission', m.slug, 'user_id', s.user_id, 'note', p_note));
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'grant', v_grant);
end $$;

revoke all on function public.claim_mission(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.submit_social_task(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.review_social_submission(uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_mission(uuid, uuid, text) to service_role;
grant execute on function public.submit_social_task(uuid, uuid, text) to service_role;
grant execute on function public.review_social_submission(uuid, boolean, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Seed tasks. Every reward here is a placeholder to tune.
-- ---------------------------------------------------------------------------

insert into public.missions (slug, title, description, kind, target, daily, reward_xp, reward_coins, reward_points, requires_review, enabled, params, secret_answer, sort_order) values
  ('tweet-rwainc', 'Tweet something about RWAINC token',
   'Post a tweet about the RWAINC token on X, then submit the link to your tweet. A reviewer checks it before the reward is paid.',
   'social_x', 1, true, 20, 20, 1, true, true, '{}'::jsonb, null, 4),
  ('stocks-top-performer', 'Spot the top performer on the RWA stocks platform',
   'Pick the stock you think is the top performer on the RWA stocks platform today. One try per day.',
   'stocks_quiz', 1, true, 15, 15, 1, false, true,
   '{"question": "Which stock is the top performer on the RWA stocks platform today?", "options": ["Stock A", "Stock B", "Stock C", "Stock D"], "is_test": true}'::jsonb,
   'Stock B', 5),
  ('refer-3-friends', 'Refer 3 friends',
   'Invite three friends. A referral counts once they verify their email and finish one accepted run.',
   'referrals', 3, false, 100, 100, 5, false, true, '{}'::jsonb, null, 6),
  ('buy-rwainc', 'Buy RWAINC tokens',
   'Hold at least the target amount of RWAINC tokens. Coming soon: verification needs the token contract and amount to be confirmed.',
   'token_purchase', 1, false, 0, 0, 10, false, false, '{"min_amount": null}'::jsonb, null, 7);
