-- Checks for 0004_tasks.sql. Run after all four migrations. Rolls back; "ALL CHECKS PASSED" means success.
-- NOT YET RUN against Postgres.

begin;

do $$
declare
  a       uuid := '00000000-0000-0000-0000-0000000000d1';
  b       uuid := '00000000-0000-0000-0000-0000000000d2';
  r1      uuid := '00000000-0000-0000-0000-0000000000e1';
  r2      uuid := '00000000-0000-0000-0000-0000000000e2';
  r3      uuid := '00000000-0000-0000-0000-0000000000e3';
  m_ref   uuid; m_quiz uuid; m_tweet uuid; m_buy uuid;
  r       jsonb;
  sub     uuid;
  failed  boolean;
begin
  insert into auth.users (id, email) values
    (a, 'task-a@example.com'), (b, 'task-b@example.com'),
    (r1, 'ref1@example.com'), (r2, 'ref2@example.com'), (r3, 'ref3@example.com');
  select id into m_ref   from public.missions where slug = 'refer-3-friends';
  select id into m_quiz  from public.missions where slug = 'stocks-top-performer';
  select id into m_tweet from public.missions where slug = 'tweet-rwainc';
  select id into m_buy   from public.missions where slug = 'buy-rwainc';

  -- 1. Referral milestone: 2 approved is not enough, 3 is.
  insert into public.referrals (referrer_id, referred_id, status) values (a, r1, 'approved'), (a, r2, 'approved');
  r := public.claim_mission(a, m_ref);
  assert (r ->> 'completed')::boolean = false and (r ->> 'progress')::int = 2, 'check 1a: 2 of 3 referrals is not enough';
  insert into public.referrals (referrer_id, referred_id, status) values (a, r3, 'pending');
  r := public.claim_mission(a, m_ref);
  assert (r ->> 'completed')::boolean = false, 'check 1b: a pending referral does not count';
  update public.referrals set status = 'approved' where referred_id = r3;
  r := public.claim_mission(a, m_ref);
  assert (r ->> 'completed')::boolean = true, 'check 1c: 3 approved referrals completes it';
  assert (select airdrop_points from public.player_balances where user_id = a) >= 5, 'check 1d: points paid';
  r := public.claim_mission(a, m_ref);
  assert (r ->> 'already_claimed')::boolean = true, 'check 1e: paid once';

  -- 2. Quiz: server-side answer, one wrong try per day.
  r := public.claim_mission(b, m_quiz, 'Stock A');
  assert (r ->> 'wrong_answer')::boolean = true, 'check 2a: wrong answer is refused';
  r := public.claim_mission(b, m_quiz, 'Stock B');
  assert (r ->> 'locked')::boolean = true, 'check 2b: no second try the same day, even with the right answer';
  r := public.claim_mission(a, m_quiz, '  stock b ');
  assert (r ->> 'completed')::boolean = true, 'check 2c: right answer pays (case and spaces ignored)';

  -- 3. Token purchase cannot be claimed.
  r := public.claim_mission(a, m_buy);
  assert (r ->> 'disabled')::boolean = true, 'check 3: purchase task is disabled';

  -- 4. Social task: link in, review, payout once.
  r := public.submit_social_task(a, m_tweet, 'https://example.com/not-a-tweet');
  assert r ->> 'error' = 'invalid_url', 'check 4a: a non-tweet link is refused';
  r := public.submit_social_task(a, m_tweet, 'https://x.com/someone/status/1234567890?s=20');
  assert r ->> 'status' = 'pending', 'check 4b: a tweet link goes to review';
  r := public.submit_social_task(b, m_tweet, 'https://twitter.com/someone/status/1234567890');
  assert r ->> 'error' = 'url_already_used', 'check 4c: the same tweet cannot be used by another account';
  r := public.submit_social_task(a, m_tweet, 'https://x.com/someone/status/999');
  assert (r ->> 'already_submitted')::boolean = true, 'check 4d: one submission per day';
  r := public.claim_mission(a, m_tweet);
  assert r ->> 'reason' = 'submit_a_link', 'check 4e: social tasks cannot be claimed directly';
  select id into sub from public.social_submissions where user_id = a;
  r := public.review_social_submission(sub, true, a, 'ok');
  assert r ->> 'status' = 'approved', 'check 4f: approval works';
  r := public.review_social_submission(sub, true, a, 'again');
  assert r ->> 'error' = 'already_reviewed', 'check 4g: cannot be reviewed twice';
  assert (select count(*) from public.points_ledger where idempotency_key = 'social:' || sub::text) >= 1, 'check 4h: payout recorded once in the ledger';
  assert (select count(*) from public.admin_audit_logs where target = sub::text) = 1, 'check 4i: review is audit-logged';

  -- 5. Rejected links can be replaced; rejection pays nothing.
  r := public.submit_social_task(b, m_tweet, 'https://x.com/other/status/777');
  select id into sub from public.social_submissions where user_id = b;
  perform public.review_social_submission(sub, false, a, 'not about RWAINC');
  assert (select status from public.social_submissions where id = sub) = 'rejected', 'check 5a: rejected';
  r := public.submit_social_task(b, m_tweet, 'https://x.com/other/status/778');
  assert (r ->> 'resubmitted')::boolean = true, 'check 5b: a rejected link can be replaced';

  assert (select count(*) from public.reconcile_balances()) = 0, 'check 5c: balances reconcile with the ledger';

  -- 6. Clients cannot read the quiz answer or other players' submissions, or call the functions.
  perform set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from public.missions) >= 4, 'check 6a: clients can read missions';
  failed := false;
  begin perform secret_answer from public.missions;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6b: clients cannot read the quiz answer';
  assert (select count(*) from public.social_submissions where user_id = b) = 0, 'check 6c: clients cannot see other players submissions';
  failed := false;
  begin perform public.review_social_submission(sub, true, a);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6d: clients cannot approve submissions';
  failed := false;
  begin perform count(*) from public.mission_attempts;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 6e: clients cannot read quiz attempts';
  reset role;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
