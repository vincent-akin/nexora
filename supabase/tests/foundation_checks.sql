-- Checks for 0001_foundation.sql.
--
-- Run in the Supabase SQL editor (or psql) AFTER applying the migration, on a
-- branch or local project. Everything happens inside one transaction that is
-- rolled back at the end, so it leaves no data behind. Any failed check raises
-- an error naming the check; "ALL CHECKS PASSED" means every assertion held.
--
-- NOT YET RUN: written alongside the migration, never executed against Postgres.

begin;

do $$
declare
  u      uuid := '00000000-0000-0000-0000-0000000000a1';
  other  uuid := '00000000-0000-0000-0000-0000000000a2';
  r      jsonb;
  sess   uuid;
  n      int;
  failed boolean;
begin
  insert into auth.users (id, email) values (u, 'check-a@example.com'), (other, 'check-b@example.com');

  -- 1. New users get a profile, balances and full stamina.
  assert (select count(*) from public.profiles where id = u) = 1, 'check 1a: profile created';
  assert (select count(*) from public.player_balances where user_id = u) = 1, 'check 1b: balances created';
  assert (select stamina from public.player_stamina where user_id = u) = 10, 'check 1c: stamina starts at the cap';
  assert (select length(referral_code) from public.profiles where id = u) = 8, 'check 1d: referral code issued';

  -- 2. grant_reward credits once and is idempotent.
  r := public.grant_reward(u, 100, 50, 5, 'check', 'game_run', null, 'k1');
  assert (r ->> 'duplicate')::boolean = false, 'check 2a: first grant applies';
  r := public.grant_reward(u, 100, 50, 5, 'check', 'game_run', null, 'k1');
  assert (r ->> 'duplicate')::boolean = true, 'check 2b: repeat key is a duplicate';
  assert (select xp from public.player_balances where user_id = u) = 100, 'check 2c: duplicate did not credit twice';

  -- 3. Daily caps clamp game-run credits (cap xp = 500, 100 already used).
  r := public.grant_reward(u, 1000, 0, 0, 'check', 'game_run', null, 'k2');
  assert (select xp from public.player_balances where user_id = u) = 500, 'check 3: xp clamped to the daily cap';

  -- 4. Balances equal their ledgers.
  assert (select count(*) from public.reconcile_balances()) = 0, 'check 4: balances reconcile with the ledger';

  -- 5. The ledger is append-only.
  failed := false;
  begin
    update public.points_ledger set amount = amount + 1 where user_id = u;
  exception when others then failed := true;
  end;
  assert failed, 'check 5a: ledger update is blocked';
  failed := false;
  begin
    delete from public.points_ledger where user_id = u;
  exception when others then failed := true;
  end;
  assert failed, 'check 5b: ledger delete is blocked';

  -- 6. Negative grants are refused.
  failed := false;
  begin
    perform public.grant_reward(u, -5, 0, 0, 'check', 'game_run', null, 'k3');
  exception when others then failed := true;
  end;
  assert failed, 'check 6: negative grant refused';

  -- 7. Stamina: ten runs succeed, the eleventh reports insufficient stamina.
  r := public.start_game_run(u, 'beat_lanes', 'normal', 123, 'v1');
  sess := (r ->> 'session_id')::uuid;
  assert sess is not null, 'check 7a: session opened';
  for n in 1..9 loop
    perform public.start_game_run(u, 'beat_lanes', 'normal', 123 + n, 'v1');
  end loop;
  r := public.start_game_run(u, 'beat_lanes', 'normal', 999, 'v1');
  assert r ->> 'error' = 'insufficient_stamina', 'check 7b: eleventh run refused';
  assert (select stamina from public.player_stamina where user_id = u) = 0, 'check 7c: stamina spent';

  -- 8. A session settles exactly once.
  perform public.settle_game_run(sess, u, 1000, 0.9, 30, 'accepted', '[]'::jsonb, 10, 5, 1);
  assert (select count(*) from public.game_scores where session_id = sess) = 1, 'check 8a: score stored';
  failed := false;
  begin
    perform public.settle_game_run(sess, u, 1000, 0.9, 30, 'accepted', '[]'::jsonb, 10, 5, 1);
  exception when others then failed := true;
  end;
  assert failed, 'check 8b: second settle of the same session refused';
  assert (select count(*) from public.reconcile_balances()) = 0, 'check 8c: still reconciled after settle';

  -- 9. A client (authenticated role) can read its own rows, not others', and cannot write.
  insert into public.points_ledger (user_id, balance_type, amount, reason, source_type, idempotency_key, rules_version)
  values (other, 'xp', 7, 'check', 'test', 'other-1', 'v0.1');
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  assert (select count(*) from public.points_ledger) > 0, 'check 9a: client sees own ledger';
  assert (select count(*) from public.points_ledger where user_id = other) = 0, 'check 9b: client cannot see another ledger';
  assert (select count(*) from public.profiles where id = other) = 0, 'check 9c: client cannot see another profile';

  failed := false;
  begin
    update public.player_balances set coins = 999999 where user_id = u;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'check 9d: client cannot edit balances';

  failed := false;
  begin
    perform public.grant_reward(u, 1000, 1000, 1000, 'cheat', 'game_run', null, 'cheat-1');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'check 9e: client cannot call grant_reward';

  failed := false;
  begin
    perform count(*) from public.risk_flags;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'check 9f: client cannot read risk flags';

  reset role;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
