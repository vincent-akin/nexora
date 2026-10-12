/**
 * Card Clash core: a memory-match game played against the clock.
 *
 * The server owns the deck. The seed never leaves the server, so a client can
 * only learn a card's face by flipping it through the API, and every flip is
 * timestamped by the server clock. This module is pure: the API routes use it
 * to apply flips and to settle a run, and the tests and the standalone
 * prototype use the same code.
 */
import { mulberry32 } from '../beat-lanes/core.ts';

export type CardDifficulty = 'easy' | 'normal' | 'hard';
export type CardVerdict = 'accepted' | 'flagged' | 'rejected';

export interface CardConfig { cols: number; rows: number; pairs: number; timeLimitMs: number }

export const CARD_CONFIG: Record<CardDifficulty, CardConfig> = {
  easy: { cols: 3, rows: 4, pairs: 6, timeLimitMs: 75000 },
  normal: { cols: 4, rows: 4, pairs: 8, timeLimitMs: 90000 },
  hard: { cols: 5, rows: 4, pairs: 10, timeLimitMs: 105000 },
};

/** Distinct card faces available (one icon each). Every deal uses `pairs` of them. */
export const FACE_COUNT = 10;
/** The server refuses flips closer together than this: no human flips two cards faster. */
export const MIN_FLIP_GAP_MS = 150;
export const MATCH_POINTS = 100;
export const MISMATCH_PENALTY = 10;
export const TIME_BONUS_PER_SEC = 5;

/** Minimum player level for each difficulty. */
export const CARD_MIN_LEVEL: Record<CardDifficulty, number> = { easy: 2, normal: 2, hard: 3 };

/** Placeholder economy values. The real values live in server-side rules config. */
export const CARD_BASE_REWARD: Record<CardDifficulty, { xp: number; coins: number; points: number }> = {
  easy: { xp: 25, coins: 12, points: 1 },
  normal: { xp: 35, coins: 18, points: 2 },
  hard: { xp: 50, coins: 28, points: 3 },
};

function shuffle<T>(items: T[], rnd: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** Deals the deck for a session: `pairs` randomly chosen faces, each twice, shuffled. */
export function dealDeck(seed: number, difficulty: CardDifficulty): number[] {
  const { pairs } = CARD_CONFIG[difficulty];
  const rnd = mulberry32(seed);
  const faces = shuffle(Array.from({ length: FACE_COUNT }, (_, i) => i), rnd).slice(0, pairs);
  return shuffle([...faces, ...faces], rnd);
}

// ---------------------------------------------------------------------------
// Replay: the game state is derived from the list of flips, never stored
// ---------------------------------------------------------------------------

/** One flip. `t` is ms since the session started, on the SERVER clock. */
export interface Flip { i: number; t: number }

export interface Replay {
  matched: boolean[];
  /** The first card of a turn that is waiting for its partner, if any. */
  pending: number | null;
  matchedPairs: number;
  mismatches: number;
  streak: number;
  bestStreak: number;
  /** Running score. The clear-time bonus is added in finalizeCards(). */
  score: number;
  done: boolean;
  lastT: number;
}

export function replay(deck: number[], flips: Flip[], difficulty: CardDifficulty): Replay {
  const matched: boolean[] = new Array(deck.length).fill(false);
  let pending: number | null = null;
  let matchedPairs = 0;
  let mismatches = 0;
  let streak = 0;
  let bestStreak = 0;
  let score = 0;
  let lastT = 0;
  for (const f of flips) {
    lastT = f.t;
    if (pending === null) {
      pending = f.i;
      continue;
    }
    if (deck[pending] === deck[f.i]) {
      score += Math.round(MATCH_POINTS * (1 + 0.25 * Math.min(4, streak)));
      streak++;
      if (streak > bestStreak) bestStreak = streak;
      matched[pending] = true;
      matched[f.i] = true;
      matchedPairs++;
    } else {
      mismatches++;
      streak = 0;
      score = Math.max(0, score - MISMATCH_PENALTY);
    }
    pending = null;
  }
  return { matched, pending, matchedPairs, mismatches, streak, bestStreak, score, done: matchedPairs === CARD_CONFIG[difficulty].pairs, lastT };
}

export type FlipOutcome =
  | { ok: true; flips: Flip[]; face: number; result: 'first' | 'match' | 'mismatch'; state: Replay }
  | { ok: false; reason: 'bad_index' | 'already_done' | 'already_matched' | 'same_card' | 'too_fast' | 'time_up' };

/** Applies one flip at server time `t`, or says why it is not allowed. */
export function applyFlip(deck: number[], flips: Flip[], index: number, t: number, difficulty: CardDifficulty): FlipOutcome {
  const cfg = CARD_CONFIG[difficulty];
  if (!Number.isInteger(index) || index < 0 || index >= deck.length) return { ok: false, reason: 'bad_index' };
  const before = replay(deck, flips, difficulty);
  if (before.done) return { ok: false, reason: 'already_done' };
  if (t > cfg.timeLimitMs) return { ok: false, reason: 'time_up' };
  if (before.matched[index]) return { ok: false, reason: 'already_matched' };
  if (before.pending === index) return { ok: false, reason: 'same_card' };
  if (flips.length && t - flips[flips.length - 1].t < MIN_FLIP_GAP_MS) return { ok: false, reason: 'too_fast' };

  const next = [...flips, { i: index, t }];
  const state = replay(deck, next, difficulty);
  const result = before.pending === null ? 'first' : state.matchedPairs > before.matchedPairs ? 'match' : 'mismatch';
  return { ok: true, flips: next, face: deck[index], result, state };
}

// ---------------------------------------------------------------------------
// Final result, validation and rewards (server side)
// ---------------------------------------------------------------------------

export interface CardFinal {
  score: number;
  matchedPairs: number;
  totalPairs: number;
  mismatches: number;
  cleared: boolean;
  timeMs: number;
  /** matched pairs over (pairs + mismatches): 1 for a flawless clear, lower with every mistake. */
  quality: number;
  bestStreak: number;
  flipCount: number;
}

export function finalizeCards(deck: number[], flips: Flip[], difficulty: CardDifficulty): CardFinal {
  const cfg = CARD_CONFIG[difficulty];
  const r = replay(deck, flips, difficulty);
  const bonus = r.done ? Math.round((Math.max(0, cfg.timeLimitMs - r.lastT) / 1000) * TIME_BONUS_PER_SEC) : 0;
  return {
    score: r.score + bonus,
    matchedPairs: r.matchedPairs,
    totalPairs: cfg.pairs,
    mismatches: r.mismatches,
    cleared: r.done,
    timeMs: r.done ? r.lastT : cfg.timeLimitMs,
    quality: r.matchedPairs / (cfg.pairs + r.mismatches),
    bestStreak: r.bestStreak,
    flipCount: flips.length,
  };
}

export interface CardValidation {
  verdict: CardVerdict;
  reasons: string[];
  flags: string[];
  final: CardFinal | null;
}

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

const MIN_HUMAN_MEDIAN_GAP_MS = 350;

/**
 * Re-applies every stored flip through the same rules as live play (so a
 * corrupted log is rejected), then looks for machine-like pacing. With the deck
 * held on the server, the only realistic cheat left is an automated player, so
 * the signals are about speed and regularity. Those flag a run for review
 * rather than reject it.
 */
export function validateCardRun(deck: number[], flips: Flip[], difficulty: CardDifficulty): CardValidation {
  let acc: Flip[] = [];
  for (const f of flips) {
    const out = applyFlip(deck, acc, f.i, f.t, difficulty);
    if (!out.ok) return { verdict: 'rejected', reasons: [out.reason], flags: [], final: null };
    acc = out.flips;
  }
  const final = finalizeCards(deck, flips, difficulty);
  const gaps = flips.slice(1).map((f, k) => f.t - flips[k].t);
  const flags: string[] = [];
  if (gaps.length >= 12) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median < MIN_HUMAN_MEDIAN_GAP_MS) flags.push('inhuman_speed');
    if (spread(gaps) < 30) flags.push('uniform_timing');
  }
  return { verdict: flags.length ? 'flagged' : 'accepted', reasons: [], flags, final };
}

export interface CardReward { xp: number; coins: number; airdropPoints: number }

/** Raw reward before the database's daily caps. Flagged runs earn no Airdrop Points. */
export function cardRewardFor(final: CardFinal, difficulty: CardDifficulty, verdict: CardVerdict): CardReward {
  if (verdict === 'rejected') return { xp: 0, coins: 0, airdropPoints: 0 };
  const base = CARD_BASE_REWARD[difficulty];
  const q = Math.max(0, Math.min(1, final.quality));
  return {
    xp: Math.round(base.xp * q),
    coins: Math.round(base.coins * q),
    airdropPoints: verdict === 'accepted' && q >= 0.5 ? base.points : 0,
  };
}

/** Key rating for the results screen: 0 to 3. A run that was not cleared tops out at one. */
export function keysFor(quality: number, cleared: boolean): number {
  const keys = quality >= 0.85 ? 3 : quality >= 0.6 ? 2 : quality >= 0.3 ? 1 : 0;
  return cleared ? keys : Math.min(keys, 1);
}
