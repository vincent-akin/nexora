-- Checks for 0002_engagement.sql. Same rules as foundation_checks.sql: run it
-- after both migrations, it rolls back, and "ALL CHECKS PASSED" means success.
--
-- NOT YET RUN against Postgres.

begin;

do $$
declare
  a      uuid := '00000000-0000-0000-0000-0000000000b1';  -- referrer
  b      uuid := '00000000-0000-0000-0000-0000000000b2';  -- referred
  r      jsonb;
  code   text;
  m_run  uuid;
  m_runs uuid;
  sess   uuid;
  failed boolean;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (a, 'ref-a@example.com', now()),
    (b, 'ref-b@example.com', now());

  -- 1. Daily claim: once per UTC day, streak starts at 1.
  r := public.claim_daily(a);
  assert (r ->> 'already_claimed')::boolean = false and (r ->> 'streak')::int = 1, 'check 1a: first claim, streak 1';
  r := public.claim_daily(a);
  assert (r ->> 'already_claimed')::boolean = true, 'check 1b: second claim the same day refused';
  assert (select coins from public.player_balances where user_id = a) = 10, 'check 1c: day-1 coins paid once';

  -- 2. Streak continues after yesterday's claim and resets after a gap.
  update public.daily_claims set claim_date = claim_date - 1 where user_id = a;      -- pretend the claim was yesterday
  r := public.claim_daily(a);
  assert (r ->> 'streak')::int = 2, 'check 2a: consecutive day extends the streak';
  update public.daily_claims set claim_date = claim_date - 5 where user_id = a;      -- now the last claim is days ago
  r := public.claim_daily(a);
  assert (r ->> 'streak')::int = 1, 'check 2b: a gap resets the streak';

  -- 3. Missions only complete from validated results.
  select id into m_run  from public.missions where slug = 'first-run';
  select id into m_runs from public.missions where slug = 'runs-3';
  r := public.claim_mission(b, m_run);
  assert (r ->> 'completed')::boolean = false, 'check 3a: no run, no mission';
  sess := (public.start_game_run(b, 'beat_lanes', 'normal', 1, 'v1') ->> 'session_id')::uuid;
  perform public.settle_game_run(sess, b, 4000, 0.8, 20, 'accepted', '[]'::jsonb, 20, 10, 1);
  r := public.claim_mission(b, m_run);
  assert (r ->> 'completed')::boolean = true, 'check 3b: first-run mission completes after an accepted run';
  r := public.claim_mission(b, m_run);
  assert (r ->> 'already_claimed')::boolean = true, 'check 3c: one-off mission cannot be claimed twice';
  r := public.claim_mission(b, m_runs);
  assert (r ->> 'completed')::boolean = false, 'check 3d: 1 run does not satisfy the 3-run mission';

  -- 4. Referrals: pending, then approved once the referred player qualifies.
  select referral_code into code from public.profiles where id = a;
  assert (public.apply_referral(b, 'nope') ->> 'reason') = 'unknown_code', 'check 4a: unknown code refused';
  assert (public.apply_referral(a, code) ->> 'reason') = 'self_referral', 'check 4b: self-referral refused';
  assert (public.apply_referral(b, code) ->> 'ok')::boolean = true, 'check 4c: referral recorded';
  assert (public.apply_referral(b, code) ->> 'reason') = 'already_referred', 'check 4d: second referral refused';
  r := public.qualify_referral(b);   -- b already has an accepted run and a verified email
  assert (r ->> 'changed')::boolean = true, 'check 4e: referral approved';
  assert (select airdrop_points from public.player_balances where user_id = a) >= 2, 'check 4f: referrer paid';
  r := public.qualify_referral(b);
  assert (r ->> 'changed')::boolean = false, 'check 4g: approval is idempotent';

  -- 5. Everything still reconciles.
  assert (select count(*) from public.reconcile_balances()) = 0, 'check 5: balances reconcile with the ledger';

  -- 6. Clients cannot call the trusted functions or read admin data.
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin perform public.claim_daily(a);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6a: client cannot call claim_daily';
  failed := false;
  begin perform count(*) from public.admin_users;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6b: client cannot read admin_users';
  failed := false;
  begin perform referred_id from public.referrals;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6c: client cannot read who was referred';
  reset role;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
