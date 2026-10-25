-- Checks for 0007_admin_practice_rules.sql. Run after all migrations. It rolls back.
begin;

do $$
declare
  adm   uuid := '00000000-0000-0000-0000-0000000000e1';
  plr   uuid := '00000000-0000-0000-0000-0000000000e2';
  r     jsonb;
  sid   uuid;
  v1    text;
  v2    text;
  failed boolean;
  before_stamina int;
  base_runs int;
begin
  insert into auth.users (id, email) values (adm, 'admin@example.com'), (plr, 'player@example.com');
  insert into public.admin_users (user_id) values (adm);

  -- 1. Practice is for admins only.
  r := public.begin_level_run(plr, 'type_sprint', 'easy', 1, 1, 'v', '{}', 12, true);
  assert r ->> 'error' = 'not_admin', 'check 1: a normal player cannot open a practice run';

  -- 2. An admin can open any level, with any boost, and it costs no stamina.
  select stamina into before_stamina from public.player_stamina where user_id = adm;
  r := public.begin_level_run(adm, 'type_sprint', 'hard', 12, 2, 'v', array['slow', 'life'], 12, true);
  assert r ->> 'session_id' is not null and (r ->> 'level')::int = 12 and (r ->> 'practice')::boolean, 'check 2a: practice at the top level';
  assert r -> 'boosts' = '["slow","life"]'::jsonb, 'check 2b: boosts recorded without owning them';
  assert (select stamina from public.player_stamina where user_id = adm) = before_stamina, 'check 2c: no stamina spent';
  assert not exists (select 1 from public.player_game_levels where user_id = adm and game = 'type_sprint'), 'check 2d: ladder untouched';
  sid := (r ->> 'session_id')::uuid;

  failed := false;
  begin perform public.begin_level_run(adm, 'type_sprint', 'easy', 1, 3, 'v', array['hint'], 12, true);
  exception when others then failed := sqlerrm like '%unknown_boost%'; end;
  assert failed, 'check 2e: a boost from another game is still refused';

  -- 3. A practice run pays nothing, even if the caller asks for a lot, and is hidden everywhere.
  r := public.settle_game_run(sid, adm, 900, 1, 20, 'accepted', '[]'::jsonb, 500, 500, 5);
  assert (r ->> 'practice')::boolean, 'check 3a: settled as practice';
  assert (select xp + coins + airdrop_points from public.player_balances where user_id = adm) = 0, 'check 3b: nothing paid';
  assert (select count(*) from public.points_ledger where user_id = adm) = 0, 'check 3c: nothing in the ledger';
  assert (select practice and boosted from public.game_scores where session_id = sid), 'check 3d: score marked practice';
  assert (select count(*) from public.leaderboard_best where game = 'type_sprint') = 0, 'check 3e: not on the leaderboard';

  -- 4. Analytics ignore practice, and still count real runs.
  r := public.admin_analytics(7);
  base_runs := (r ->> 'runs_total')::int;
  assert base_runs = 0, 'check 4a: practice not counted in runs';
  r := public.begin_level_run(plr, 'beat_lanes', 'easy', 1, 4, 'v', '{}', 10, false);
  perform public.settle_game_run((r ->> 'session_id')::uuid, plr, 100, 0.9, 5, 'accepted', '[]'::jsonb, 10, 10, 1);
  assert (public.admin_analytics(7) ->> 'runs_total')::int = 1, 'check 4b: real runs counted';

  -- 5. Normal start still works the old way for the same admin account (not practice).
  r := public.begin_level_run(adm, 'beat_lanes', 'easy', 5, 5, 'v', '{}', 10);
  assert r ->> 'error' = 'level_locked', 'check 5: without practice the ladder still applies';

  -- 6. Rules: validation, publishing, switching, history.
  select (config) into r from public.rules_versions where active;
  failed := false;
  begin perform public.publish_rules(jsonb_set(r, '{session_ttl_seconds}', '100'), adm, 'too short');
  exception when others then failed := sqlerrm like '%session_ttl_seconds%'; end;
  assert failed, 'check 6a: a session shorter than a run is refused';
  failed := false;
  begin perform public.publish_rules(jsonb_set(r, '{daily_caps,xp}', '0'), adm, 'zero');
  exception when others then failed := sqlerrm like '%xp cap%'; end;
  assert failed, 'check 6b: a zero cap is refused';
  failed := false;
  begin perform public.publish_rules('{"stamina_cap": "lots"}'::jsonb, adm, 'junk');
  exception when others then failed := true; end;
  assert failed, 'check 6c: junk is refused';
  assert (select count(*) from public.rules_versions where active) = 1, 'check 6d: still exactly one active version';

  v1 := (select version from public.rules_versions where active);
  v2 := public.publish_rules(jsonb_set(r, '{stamina_cap}', '20'), adm, 'more stamina');
  assert (select version from public.rules_versions where active) = v2, 'check 6e: new version active';
  assert (select count(*) from public.rules_versions where active) = 1, 'check 6f: old version switched off';
  assert (select note from public.rules_versions where version = v2) = 'more stamina', 'check 6g: note kept';
  perform public.activate_rules(v1);
  assert (select version from public.rules_versions where active) = v1, 'check 6h: rolled back';
  failed := false;
  begin perform public.activate_rules('nope'); exception when others then failed := true; end;
  assert failed, 'check 6i: unknown version refused';

  -- 7. Clients cannot call any of it.
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  failed := false; begin perform public.publish_rules(r, adm, 'x'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 7a: client cannot publish rules';
  failed := false; begin perform public.begin_level_run(adm, 'beat_lanes', 'easy', 1, 1, 'v', '{}', 10, true); exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 7b: client cannot open practice runs directly';
  failed := false; begin perform count(*) from public.game_scores_real; exception when insufficient_privilege then failed := true; end;
  assert failed, 'check 7c: client cannot read the analytics views';
  reset role;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
