-- Checks for 0006_levels_boosts_admin.sql. Same rules as the other check scripts: run it
-- after all migrations, it rolls back, and "ALL CHECKS PASSED" means success.

begin;

do $$
declare
  u     uuid := '00000000-0000-0000-0000-0000000000d1';
  r     jsonb;
  sid   uuid;
  item  uuid;
  failed boolean;
  n     int;
begin
  insert into auth.users (id, email) values (u, 'levels@example.com');

  -- 1. A new player has level 1 unlocked and nothing else.
  r := public.begin_level_run(u, 'type_sprint', 'easy', 2, 1, 'v', '{}', 12);
  assert r ->> 'error' = 'level_locked', 'check 1a: level 2 is locked for a new player';
  r := public.begin_level_run(u, 'type_sprint', 'easy', 13, 1, 'v', '{}', 12);
  assert r ->> 'error' = 'bad_level', 'check 1b: a level above the cap is refused';
  r := public.begin_level_run(u, 'type_sprint', 'easy', 1, 1, 'v', '{}', 12);
  assert r ->> 'session_id' is not null and (r ->> 'level')::int = 1, 'check 1c: level 1 opens';
  assert (select stamina from public.player_stamina where user_id = u) = 9, 'check 1d: one stamina spent';

  -- 2. Unlocking raises, never lowers, and respects the cap.
  assert public.unlock_game_level(u, 'type_sprint', 4, 12) = 4, 'check 2a: unlock to 4';
  assert public.unlock_game_level(u, 'type_sprint', 2, 12) = 4, 'check 2b: never lowered';
  assert public.unlock_game_level(u, 'type_sprint', 99, 12) = 12, 'check 2c: capped';
  assert public.unlock_game_level(u, 'beat_lanes', 3, 10) = 3, 'check 2d: games are independent';

  -- 3. Boosts: not owned means the whole start rolls back, stamina included.
  select stamina into n from public.player_stamina where user_id = u;
  failed := false;
  begin
    perform public.begin_level_run(u, 'type_sprint', 'easy', 1, 2, 'v', array['slow'], 12);
  exception when others then failed := sqlerrm like '%boost_not_owned%';
  end;
  assert failed, 'check 3a: an unowned boost is refused';
  assert (select stamina from public.player_stamina where user_id = u) = n, 'check 3b: the refused start cost no stamina';
  assert (select count(*) from public.game_sessions where user_id = u) = 1, 'check 3c: and opened no session';

  -- 4. Buy the boost, then spend it.
  update public.player_balances set coins = 1000, xp = 1000 where user_id = u;
  select id into item from public.shop_items where slug = 'ts-boost-slow';
  r := public.purchase_item(u, item, gen_random_uuid());
  assert (r ->> 'ok')::boolean, 'check 4a: boost purchased';
  r := public.begin_level_run(u, 'type_sprint', 'easy', 1, 3, 'v', array['slow'], 12);
  assert r -> 'boosts' = '["slow"]'::jsonb, 'check 4b: boost recorded on the session';
  assert (select quantity from public.player_items where user_id = u and item_id = item) = 0, 'check 4c: one boost used up';
  sid := (r ->> 'session_id')::uuid;

  failed := false;
  begin perform public.begin_level_run(u, 'type_sprint', 'easy', 1, 4, 'v', array['slow'], 12);
  exception when others then failed := true; end;
  assert failed, 'check 4d: the same boost cannot be spent twice';

  failed := false;
  begin perform public.begin_level_run(u, 'type_sprint', 'easy', 1, 5, 'v', array['hint'], 12);
  exception when others then failed := sqlerrm like '%unknown_boost%'; end;
  assert failed, 'check 4e: a boost that belongs to another game is refused';

  -- 5. A boosted run earns no Airdrop Points, even if the caller asks for them, and is off the board.
  r := public.settle_game_run(sid, u, 500, 0.9, 10, 'accepted', '[]'::jsonb, 30, 20, 5);
  assert coalesce((r -> 'grant' -> 'granted' ->> 'airdrop_points')::int, 0) = 0, 'check 5a: no Airdrop Points';
  assert (r -> 'grant' -> 'granted' ->> 'coins')::int = 20, 'check 5b: Coins still paid';
  assert (select boosted from public.game_scores where session_id = sid), 'check 5c: score marked boosted';
  assert (select count(*) from public.leaderboard_best where game = 'type_sprint') = 0, 'check 5d: not on the leaderboard';

  -- 6. An unboosted run does appear.
  r := public.begin_level_run(u, 'beat_lanes', 'easy', 1, 6, 'v', '{}', 10);
  r := public.settle_game_run((r ->> 'session_id')::uuid, u, 700, 0.9, 10, 'accepted', '[]'::jsonb, 30, 20, 2);
  assert (r -> 'grant' -> 'granted' ->> 'airdrop_points')::int = 2, 'check 6a: Airdrop Points paid on a clean run';
  assert (select count(*) from public.leaderboard_best where game = 'beat_lanes') = 1, 'check 6b: clean run is on the board';

  -- 7. Suspended players cannot start runs.
  update public.profiles set account_status = 'suspended' where id = u;
  r := public.begin_level_run(u, 'beat_lanes', 'easy', 1, 7, 'v', '{}', 10);
  assert r ->> 'error' = 'account_suspended', 'check 7: suspended accounts are refused';
  update public.profiles set account_status = 'active' where id = u;

  -- 8. Card Clash shop items moved to Block Drop with owners intact.
  assert (select count(*) from public.shop_items where game = 'block_drop' and category <> 'bonus') = 3, 'check 8a: three Block Drop skins and sounds';
  assert (select count(*) from public.shop_items where game = 'card_clash') = 0, 'check 8b: none left on Card Clash';

  -- 9. Clients cannot call the new functions or write to progress.
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false;
  begin perform public.unlock_game_level(u, 'beat_lanes', 10, 10);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 9a: client cannot unlock levels';
  failed := false;
  begin perform public.begin_level_run(u, 'beat_lanes', 'easy', 1, 1, 'v', '{}', 10);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 9b: client cannot open runs directly';
  failed := false;
  begin perform public.admin_analytics(7);
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 9c: client cannot read analytics';
  assert (select count(*) from public.player_game_levels) = 2, 'check 9d: client reads only its own progress';
  reset role;

  -- 10. Analytics runs and reports sensible numbers.
  r := public.admin_analytics(7);
  assert (r ->> 'players_total')::int >= 1, 'check 10a: players counted';
  assert jsonb_array_length(r -> 'per_day') = 7, 'check 10b: seven days of history';
  assert (r ->> 'boosted_runs_7d')::int = 1, 'check 10c: boosted runs counted';

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
