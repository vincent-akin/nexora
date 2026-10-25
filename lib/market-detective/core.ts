/**
 * Market Detective core: a chart-reading puzzle. Each round shows a few price
 * charts and asks one question (highest return, lowest return, or most
 * volatile). The server holds the seed, hands out one round at a time, times
 * the answer on its own clock, and checks it. This module is pure.
 *
 * TEST DATA: the series are generated from a seed and the companies are made
 * up. Nothing here comes from a real market or from the RWA stocks platform.
 * To use real data later, replace buildRound()'s series source behind the same
 * shape (see SeriesSource) and keep everything else.
 */
import { mulberry32 } from '../beat-lanes/core.ts';
import { GAMES, clampLevel, scaleReward, tierFor } from '../levels.ts';
import { hasBoost, type BoostKind } from '../boosts.ts';

export type DetectiveDifficulty = 'easy' | 'normal' | 'hard';
export type DetectiveVerdict = 'accepted' | 'flagged' | 'rejected';
export type QuestionKind = 'highest_return' | 'lowest_return' | 'most_volatile';

export interface DetectiveConfig {
  rounds: number;
  roundMs: number;
  options: number;
  /** How clearly the right answer must beat the runner-up (percentage points, or volatility units). */
  minMargin: number;
  kinds: QuestionKind[];
}

/** What a run is played at: the level on the ladder, and the boosts spent on it. */
export interface DetectiveSpec { level: number; boosts: BoostKind[] }

export const DETECTIVE_MAX_LEVEL = GAMES.market_detective.maxLevel;
export const DETECTIVE_MIN_LEVEL = GAMES.market_detective.minAccountLevel;
export const TIME_BOOST_MS = 10000;

/**
 * The ladder. Higher levels mean more rounds, less time per round, more companies to compare,
 * closer calls between the top two, and (from level 3 and 6) harder kinds of question.
 */
export function detectiveConfig(spec: DetectiveSpec): DetectiveConfig {
  const L = clampLevel(spec.level, DETECTIVE_MAX_LEVEL);
  return {
    rounds: 5 + Math.floor(L / 2),
    roundMs: Math.max(9000, 26000 - 1700 * (L - 1)) + (hasBoost(spec.boosts, 'time') ? TIME_BOOST_MS : 0),
    options: L <= 2 ? 3 : L <= 6 ? 4 : 5,
    minMargin: Math.max(3, 14 - 1.1 * L),
    kinds: L <= 2 ? ['highest_return'] : L <= 5 ? ['highest_return', 'lowest_return'] : ['highest_return', 'lowest_return', 'most_volatile'],
  };
}

/** The tier a level belongs to, for rewards and the leaderboard. */
export const detectiveTier = (level: number): DetectiveDifficulty => tierFor(level, DETECTIVE_MAX_LEVEL);

export const SERIES_LENGTH = 30;
export const CORRECT_POINTS = 100;
export const SPEED_POINTS_PER_SEC = 4;

/** Made-up companies for the test dataset. */
export const TEST_COMPANIES: { ticker: string; name: string }[] = [
  { ticker: 'ALDR', name: 'Alder Freight' }, { ticker: 'BRWL', name: 'Brightwell Energy' }, { ticker: 'CNDR', name: 'Cinder Labs' },
  { ticker: 'DNMR', name: 'Dunmore Foods' }, { ticker: 'EMBR', name: 'Ember Rail' }, { ticker: 'FJRD', name: 'Fjord Marine' },
  { ticker: 'GLNH', name: 'Glenhaven Bio' }, { ticker: 'HRBM', name: 'Harbor Metals' }, { ticker: 'IRLF', name: 'Ironleaf Retail' },
  { ticker: 'JNPR', name: 'Juniper Cloud' },
];

/** Placeholder economy values. The real values live in server-side rules config. */
export const DETECTIVE_BASE_REWARD: Record<DetectiveDifficulty, { xp: number; coins: number; points: number }> = {
  easy: { xp: 25, coins: 14, points: 1 },
  normal: { xp: 35, coins: 20, points: 2 },
  hard: { xp: 50, coins: 30, points: 3 },
};

export interface Option { ticker: string; name: string; series: number[] }

/** What the player sees for a round. It never contains the answer. */
export interface PublicRound {
  index: number; kind: QuestionKind; prompt: string; options: Option[]; roundMs: number;
  /** Wrong answers crossed out by the Cross-out boost. Absent without the boost. */
  crossedOut?: number[];
}

/** The full round, server side only. */
export interface Round extends PublicRound {
  answer: number;
  /** The metric each option is judged on (percent return, or volatility). Revealed after answering. */
  metrics: number[];
}

const PROMPTS: Record<QuestionKind, string> = {
  highest_return: 'Which stock had the highest return over this period?',
  lowest_return: 'Which stock had the lowest return over this period?',
  most_volatile: 'Which stock was the most volatile?',
};

function gauss(rnd: () => number): number {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
}

function makeSeries(rnd: () => number): number[] {
  const drift = (rnd() - 0.5) * 1.6; // percent per step
  const vol = 0.8 + rnd() * 2.6;
  const out = [100];
  for (let i = 1; i < SERIES_LENGTH; i++) out.push(Math.max(5, out[i - 1] * (1 + (drift + gauss(rnd) * vol) / 100)));
  return out.map((v) => Math.round(v * 100) / 100);
}

const returnPct = (s: number[]) => ((s[s.length - 1] - s[0]) / s[0]) * 100;
function volatility(s: number[]): number {
  const r = s.slice(1).map((v, i) => ((v - s[i]) / s[i]) * 100);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  return Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
}

/** Builds round `index` for a session. Deterministic: the same seed always yields the same round. */
export function buildRound(seed: number, index: number, spec: DetectiveSpec): Round {
  const cfg = detectiveConfig(spec);
  const kind = cfg.kinds[index % cfg.kinds.length];
  const margin = kind === 'most_volatile' ? Math.max(0.5, cfg.minMargin / 8) : cfg.minMargin;
  let best: Round | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rnd = mulberry32((seed + index * 7919 + attempt * 104729) >>> 0);
    const companies = [...TEST_COMPANIES].sort(() => rnd() - 0.5).slice(0, cfg.options);
    const options = companies.map((c) => ({ ...c, series: makeSeries(rnd) }));
    const metrics = options.map((o) => (kind === 'most_volatile' ? volatility(o.series) : returnPct(o.series)));
    const pick = kind === 'lowest_return' ? Math.min(...metrics) : Math.max(...metrics);
    const answer = metrics.indexOf(pick);
    const others = metrics.filter((_, i) => i !== answer);
    const runnerUp = kind === 'lowest_return' ? Math.min(...others) : Math.max(...others);
    const gap = Math.abs(pick - runnerUp);
    const round: Round = { index, kind, prompt: PROMPTS[kind], options, roundMs: cfg.roundMs, answer, metrics: metrics.map((m) => Math.round(m * 100) / 100) };
    if (gap >= margin) return round;
    if (!best) best = round;
  }
  return best!; // extremely unlikely: a unique best with a smaller margin
}

/** Up to two wrong options to cross out. Picked from the seed, so a refresh shows the same ones. */
export function crossedOutFor(r: Round, seed: number): number[] {
  const wrong = r.options.map((_, i) => i).filter((i) => i !== r.answer);
  const rnd = mulberry32((seed + r.index * 31337) >>> 0);
  const order = wrong.sort(() => rnd() - 0.5);
  return order.slice(0, Math.min(2, Math.max(0, r.options.length - 2))).sort((a, b) => a - b);
}

export function publicRound(r: Round, spec?: DetectiveSpec, seed = 0): PublicRound {
  const out: PublicRound = { index: r.index, kind: r.kind, prompt: r.prompt, options: r.options, roundMs: r.roundMs };
  if (spec && hasBoost(spec.boosts, 'hint')) out.crossedOut = crossedOutFor(r, seed);
  return out;
}

// ---------------------------------------------------------------------------
// Answers, replay and scoring
// ---------------------------------------------------------------------------

/** One answered round. `choice` is -1 for a timeout. `ms` is the server-measured time the player took. */
export interface AnswerRec { n: number; choice: number; ms: number }

export interface DetectiveState { score: number; correct: number; answered: number; streak: number; bestStreak: number; done: boolean }

export function roundScore(correct: boolean, ms: number, roundMs: number, streakBefore: number): number {
  if (!correct) return 0;
  const speed = Math.round((Math.max(0, roundMs - ms) / 1000) * SPEED_POINTS_PER_SEC);
  return Math.round((CORRECT_POINTS + speed) * (1 + 0.25 * Math.min(4, streakBefore)));
}

export function replayDetective(seed: number, spec: DetectiveSpec, answers: AnswerRec[]): DetectiveState {
  const cfg = detectiveConfig(spec);
  let score = 0, correct = 0, streak = 0, best = 0;
  for (const a of answers) {
    const r = buildRound(seed, a.n, spec);
    const ok = a.choice === r.answer;
    score += roundScore(ok, a.ms, cfg.roundMs, streak);
    if (ok) { correct++; streak++; if (streak > best) best = streak; } else streak = 0;
  }
  return { score, correct, answered: answers.length, streak, bestStreak: best, done: answers.length >= cfg.rounds };
}

export interface DetectiveFinal { score: number; correct: number; rounds: number; quality: number; bestStreak: number; medianMs: number }

export function finalizeDetective(seed: number, spec: DetectiveSpec, answers: AnswerRec[]): DetectiveFinal {
  const cfg = detectiveConfig(spec);
  const s = replayDetective(seed, spec, answers);
  const times = answers.map((a) => a.ms).sort((a, b) => a - b);
  return { score: s.score, correct: s.correct, rounds: cfg.rounds, quality: s.correct / cfg.rounds, bestStreak: s.bestStreak, medianMs: times.length ? times[Math.floor(times.length / 2)] : 0 };
}

export type AnswerOutcome =
  | { ok: true; answers: AnswerRec[]; correct: boolean; answerIndex: number; metrics: number[]; state: DetectiveState }
  | { ok: false; reason: 'bad_round' | 'bad_choice' | 'already_done' };

/** Applies an answer to round `n`. A time over the limit (plus a short grace) counts as a timeout. */
export function applyAnswer(seed: number, spec: DetectiveSpec, answers: AnswerRec[], n: number, choice: number, ms: number): AnswerOutcome {
  const cfg = detectiveConfig(spec);
  if (answers.length >= cfg.rounds) return { ok: false, reason: 'already_done' };
  if (n !== answers.length) return { ok: false, reason: 'bad_round' };
  if (!Number.isInteger(choice) || choice < -1 || choice >= cfg.options) return { ok: false, reason: 'bad_choice' };
  const timedOut = ms > cfg.roundMs + GRACE_MS;
  const rec: AnswerRec = { n, choice: timedOut ? -1 : choice, ms: Math.min(ms, cfg.roundMs) };
  const next = [...answers, rec];
  const r = buildRound(seed, n, spec);
  return { ok: true, answers: next, correct: rec.choice === r.answer, answerIndex: r.answer, metrics: r.metrics, state: replayDetective(seed, spec, next) };
}

const GRACE_MS = 1500;

// ---------------------------------------------------------------------------
// Validation and rewards
// ---------------------------------------------------------------------------

export interface DetectiveValidation { verdict: DetectiveVerdict; reasons: string[]; flags: string[]; final: DetectiveFinal | null }

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

/**
 * Re-applies the stored answers through the same rules, then looks for machine-like
 * speed. The charts are visible to the player, so a script could compute the answer;
 * instant or evenly spaced answers are the tell, and they flag the run for review.
 */
export function validateDetective(seed: number, spec: DetectiveSpec, answers: AnswerRec[]): DetectiveValidation {
  let acc: AnswerRec[] = [];
  for (const a of answers) {
    const out = applyAnswer(seed, spec, acc, a.n, a.choice, a.ms);
    if (!out.ok) return { verdict: 'rejected', reasons: [out.reason], flags: [], final: null };
    acc = out.answers;
  }
  const final = finalizeDetective(seed, spec, answers);
  const flags: string[] = [];
  if (answers.length >= 5) {
    if (final.medianMs < 1200) flags.push('inhuman_speed');
    if (spread(answers.map((a) => a.ms)) < 40) flags.push('uniform_timing');
  }
  return { verdict: flags.length ? 'flagged' : 'accepted', reasons: [], flags, final };
}

export interface DetectiveReward { xp: number; coins: number; airdropPoints: number }

export function detectiveRewardFor(f: DetectiveFinal, spec: DetectiveSpec, verdict: DetectiveVerdict): DetectiveReward {
  if (verdict === 'rejected') return { xp: 0, coins: 0, airdropPoints: 0 };
  const base = DETECTIVE_BASE_REWARD[detectiveTier(spec.level)];
  const q = Math.max(0, Math.min(1, f.quality));
  return scaleReward(
    { xp: Math.round(base.xp * q), coins: Math.round(base.coins * q), airdropPoints: verdict === 'accepted' && q >= 0.5 ? base.points : 0 },
    spec.level, spec.boosts.length > 0,
  );
}

/** A level counts as cleared at 60% correct or better. Clearing unlocks the next one. */
export const detectiveCleared = (f: DetectiveFinal) => f.quality >= 0.6;

export function detectiveStars(quality: number): number {
  return quality >= 0.85 ? 3 : quality >= 0.6 ? 2 : quality >= 0.3 ? 1 : 0;
}
