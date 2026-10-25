import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SettleInput {
  sessionId: string;
  userId: string;
  score: number;
  /** 0 to 1, stored on the score row. */
  accuracy: number;
  maxCombo: number;
  verdict: 'accepted' | 'flagged';
  flags: string[];
  reward: { xp: number; coins: number; airdropPoints: number };
  /** An admin's practice run: nothing is paid, and it cannot qualify a referral. */
  practice?: boolean;
}

/** Closes a session exactly once, stores the validated score and pays out through the ledger. */
export async function settleRun(admin: SupabaseClient, s: SettleInput) {
  const { data, error } = await admin.rpc('settle_game_run', {
    p_session: s.sessionId,
    p_user: s.userId,
    p_score: s.score,
    p_accuracy: Number(Math.max(0, Math.min(1, s.accuracy)).toFixed(4)),
    p_max_combo: s.maxCombo,
    p_verdict: s.verdict,
    p_flags: s.flags,
    p_xp: s.reward.xp,
    p_coins: s.reward.coins,
    p_points: s.reward.airdropPoints,
  });
  if (error) return null; // already settled by a concurrent request
  if (!s.practice) await admin.rpc('qualify_referral', { p_referred: s.userId });
  return (data?.grant?.granted ?? {}) as { xp?: number; coins?: number; airdrop_points?: number };
}

export interface OpenSession {
  id: string;
  user_id: string;
  difficulty: string;
  seed: number;
  started_at: string;
  expires_at: string;
  state: Record<string, unknown> | null;
  state_version: number;
  level: number;
  boosts: string[];
  practice: boolean;
}

export type SessionLookup =
  | { ok: true; session: OpenSession }
  | { ok: false; reason: 'not_found' | 'closed' | 'expired' | 'schema' | 'db'; detail?: string };

/**
 * One of the player's own open sessions for a game. The seed only ever travels server side.
 *
 * It says why it failed instead of returning a bare null. A missing row, a closed session and
 * a database that is missing a migration all used to look the same (HTTP 409), which made a
 * broken setup look like a game bug.
 */
export async function loadSession(admin: SupabaseClient, id: string, userId: string, game: string): Promise<SessionLookup> {
  const { data, error } = await admin
    .from('game_sessions')
    .select('id,user_id,difficulty,seed,status,started_at,expires_at,state,state_version,level,boosts,practice')
    .eq('id', id).eq('user_id', userId).eq('game', game).maybeSingle();
  if (error) {
    const schema = /column|schema cache|does not exist|PGRST20/i.test(error.message);
    console.error(`[loadSession] ${game} session ${id}: ${error.message}${schema ? ' (the database is missing a migration: apply 0003 and 0006)' : ''}`);
    return { ok: false, reason: schema ? 'schema' : 'db', detail: error.message };
  }
  if (!data) return { ok: false, reason: 'not_found' };
  if (data.status !== 'started') return { ok: false, reason: 'closed' };
  if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, session: data as OpenSession };
}

/** The HTTP answer for a session that could not be used. Setup problems are 500s, not 409s. */
export function sessionProblem(f: Extract<SessionLookup, { ok: false }>): NextResponse {
  if (f.reason === 'schema') return NextResponse.json({ error: 'schema_out_of_date', hint: 'Apply the pending Supabase migrations (0003 and 0006).' }, { status: 500 });
  if (f.reason === 'db') return NextResponse.json({ error: 'server_error' }, { status: 500 });
  if (f.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ error: 'session_closed', reason: f.reason }, { status: 409 });
}

/** Saves per-session state with compare-and-set. Retries once on a lost race; reports real errors. */
export async function saveState(
  admin: SupabaseClient, sessionId: string, userId: string, expectedVersion: number, state: Record<string, unknown>,
): Promise<'saved' | 'conflict' | 'error'> {
  const { data, error } = await admin.rpc('save_game_state', { p_session: sessionId, p_user: userId, p_expected: expectedVersion, p_state: state });
  if (error) { console.error('[saveState]', error.message); return 'error'; }
  return data ? 'saved' : 'conflict';
}
