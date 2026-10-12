-- Checks for 0003_card_clash.sql. Same rules as the other check scripts: run it
-- after all three migrations, it rolls back, and "ALL CHECKS PASSED" means success.
--
-- NOT YET RUN against Postgres.

begin;

do $$
declare
  u      uuid := '00000000-0000-0000-0000-0000000000c1';
  sess   uuid;
  ok     boolean;
  failed boolean;
begin
  insert into auth.users (id, email) values (u, 'cards@example.com');
  sess := (public.start_game_run(u, 'card_clash', 'normal', 424242, 'card-clash-v1') ->> 'session_id')::uuid;
  assert sess is not null, 'check 1: a card_clash session opens';

  -- 2. State saves are compare-and-set: a stale version loses.
  ok := public.save_game_state(sess, u, 0, '{"flips":[{"i":3,"t":900}]}'::jsonb);
  assert ok, 'check 2a: first save with the right version succeeds';
  ok := public.save_game_state(sess, u, 0, '{"flips":[]}'::jsonb);
  assert not ok, 'check 2b: a stale version is refused';
  assert (select state_version from public.game_sessions where id = sess) = 1, 'check 2c: version advanced once';
  assert (select state -> 'flips' -> 0 ->> 'i' from public.game_sessions where id = sess) = '3', 'check 2d: the winning state is kept';

  -- 3. A closed session cannot be saved to.
  perform public.settle_game_run(sess, u, 100, 0.5, 1, 'accepted', '[]'::jsonb, 1, 1, 0);
  ok := public.save_game_state(sess, u, 1, '{"flips":[]}'::jsonb);
  assert not ok, 'check 3: a settled session refuses state changes';

  -- 4. The deck stays secret: a client cannot read the seed or the state.
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  assert (select count(*) from (select id, status from public.game_sessions) s) = 1, 'check 4a: client can read its own session id and status';
  failed := false;
  begin perform seed from public.game_sessions;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 4b: client cannot read the seed';
  failed := false;
  begin perform state from public.game_sessions;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 4c: client cannot read the session state';
  failed := false;
  begin perform * from public.game_sessions;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 4d: select * is refused, so a careless query cannot leak the deck';
  failed := false;
  begin perform public.save_game_state(sess, u, 1, '{}'::jsonb);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 4e: client cannot call save_game_state';
  reset role;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
