import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CARD_CONFIG,
  cardRewardFor,
  dealDeck,
  validateCardRun,
  type CardDifficulty,
  type CardFinal,
  type Flip,
} from './core';

export interface CardSession {
  id: string;
  user_id: string;
  difficulty: CardDifficulty;
  seed: number;
  status: string;
  started_at: string;
  expires_at: string;
  state: { flips?: Flip[] } | null;
  state_version: number;
}

/** Loads one of the player's own open sessions. The seed and state only ever travel server-side. */
export async function loadOpenSession(admin: SupabaseClient, id: string, userId: string): Promise<CardSession | null> {
  const { data } = await admin
    .from('game_sessions')
    .select('id,user_id,difficulty,seed,status,started_at,expires_at,state,state_version,game')
    .eq('id', id)
    .eq('user_id', userId)
    .eq('game', 'card_clash')
    .maybeSingle();
  if (!data || data.status !== 'started' || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data as CardSession;
}

/** Milliseconds since the session opened, on the server clock. The client never supplies a time. */
export const serverElapsedMs = (s: CardSession) => Date.now() - new Date(s.started_at).getTime();

export function deckFor(s: CardSession): number[] {
  return dealDeck(Number(s.seed), s.difficulty);
}

export interface SettledCardRun extends CardFinal {
  verdict: 'accepted' | 'flagged' | 'rejected';
  flags: string[];
  reasons: string[];
  granted: { xp?: number; coins?: number; airdrop_points?: number };
}

/** Validates the stored flips, closes the session exactly once and pays out through the ledger. */
export async function settleCardRun(admin: SupabaseClient, session: CardSession, flips: Flip[]): Promise<SettledCardRun | null> {
  const difficulty = session.difficulty;
  const deck = deckFor(session);
  const v = validateCardRun(deck, flips, difficulty);

  if (v.verdict === 'rejected' || !v.final) {
    await admin.rpc('reject_game_run', { p_session: session.id, p_user: session.user_id, p_reasons: v.reasons });
    return {
      score: 0, matchedPairs: 0, totalPairs: CARD_CONFIG[difficulty].pairs, mismatches: 0, cleared: false, timeMs: 0,
      quality: 0, bestStreak: 0, flipCount: flips.length, verdict: 'rejected', flags: [], reasons: v.reasons, granted: {},
    };
  }

  const reward = cardRewardFor(v.final, difficulty, v.verdict);
  const { data, error } = await admin.rpc('settle_game_run', {
    p_session: session.id,
    p_user: session.user_id,
    p_score: v.final.score,
    p_accuracy: Number(v.final.quality.toFixed(4)),
    p_max_combo: v.final.bestStreak,
    p_verdict: v.verdict,
    p_flags: v.flags,
    p_xp: reward.xp,
    p_coins: reward.coins,
    p_points: reward.airdropPoints,
  });
  if (error) return null; // already settled by a concurrent request
  await admin.rpc('qualify_referral', { p_referred: session.user_id });
  return { ...v.final, verdict: v.verdict, flags: v.flags, reasons: [], granted: data?.grant?.granted ?? {} };
}
