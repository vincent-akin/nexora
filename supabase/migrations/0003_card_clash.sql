-- Card Clash support (PRD game lineup). Apply after 0001 and 0002.
--
-- Card Clash keeps the deck on the server: the session seed deals the cards and
-- must never reach the player. Two changes make that true and let a game keep
-- per-session state:
--   1. game_sessions gains a state column (the list of flips) with a version
--      counter for safe concurrent updates.
--   2. Clients lose SELECT on the secret columns (seed, state, ...) and keep
--      only the harmless ones.
--
-- NOT YET RUN against Postgres. Run supabase/tests/card_clash_checks.sql after it.

alter table public.game_sessions
  add column state         jsonb not null default '{}'::jsonb,
  add column state_version int   not null default 0;

-- Column-level grants: replace the table-wide SELECT from 0001 with a safe list.
-- seed, content_version, state and state_version are server-only.
revoke select on public.game_sessions from authenticated;
grant select (id, user_id, game, difficulty, status, started_at, expires_at, submitted_at)
  on public.game_sessions to authenticated;

-- Compare-and-set save of a session's state. Returns false if another request
-- changed the state first (the caller re-reads and retries), or if the session
-- is no longer open.
create function public.save_game_state(p_session uuid, p_user uuid, p_expected int, p_state jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_rows int;
begin
  update public.game_sessions
     set state = p_state, state_version = state_version + 1
   where id = p_session and user_id = p_user and status = 'started'
     and expires_at > now() and state_version = p_expected;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

revoke all on function public.save_game_state(uuid, uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.save_game_state(uuid, uuid, int, jsonb) to service_role;
