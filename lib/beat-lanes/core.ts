/**
 * Beat Lanes core: deterministic chart generation, scoring, submission
 * validation and reward calculation.
 *
 * Pure functions, no I/O. The same file runs in the browser (live feedback)
 * and on the server (the only place a result is trusted). The client never
 * sends a score or a reward amount: it sends a tap log, and the server calls
 * validateSubmission() and rewardFor() with its own session data.
 */

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Grade = 'perfect' | 'good' | 'early' | 'miss';
export type Verdict = 'accepted' | 'flagged' | 'rejected';

/** A note the player must hit. `t` is ms from run start. */
export interface Note { id: number; lane: number; t: number }
/** A recorded tap. `t` is ms from run start on the client clock. */
export interface Tap { lane: number; t: number }

export interface DifficultyConfig {
  bpm: number;
  durationMs: number;
  maxMisses: number;
  /** Chance that an eighth-note step contains a note. */
  density: number;
  /** How long a tile takes to fall from the top of the screen to the hit line. Also sets how early a tile can be tapped. */
  travelMs: number;
}

export const LANES = 4;
export const LEAD_IN_MS = 2000;
export const TAIL_MS = 1500;
/** Hit windows, in ms either side of the note time. */
export const WINDOWS = { perfectMs: 45, goodMs: 110 } as const;
/**
 * A tile can be tapped as soon as it is on screen. Taps earlier than the good
 * window still pop the tile, but score as 'early': a little credit, no lost
 * life, and the combo neither grows nor breaks.
 */
export const EARLY_FRACTION = 0.9;
export const earlyWindowMs = (d: Difficulty): number => Math.round(DIFFICULTY[d].travelMs * EARLY_FRACTION);
export const EARLY_POINTS = 20;
export const EARLY_WEIGHT = 0.25;
/** Largest timing offset a player may calibrate. */
export const OFFSET_LIMIT_MS = 150;

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: { bpm: 84, durationMs: 45000, maxMisses: 10, density: 0.55, travelMs: 1600 },
  normal: { bpm: 104, durationMs: 60000, maxMisses: 8, density: 0.65, travelMs: 1350 },
  hard: { bpm: 126, durationMs: 75000, maxMisses: 6, density: 0.75, travelMs: 1100 },
};

/** Placeholder economy values. The real values live in server-side rules config. */
export const BASE_REWARD: Record<Difficulty, { xp: number; coins: number; points: number }> = {
  easy: { xp: 20, coins: 10, points: 1 },
  normal: { xp: 30, coins: 15, points: 2 },
  hard: { xp: 45, coins: 25, points: 3 },
};

// ---------------------------------------------------------------------------
// Chart generation
// ---------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32). Same seed gives the same chart everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextLane(lane: number, r: number): number {
  // A random walk across the lanes gives the tapped melody a contour.
  const delta = r < 0.3 ? 0 : r < 0.55 ? 1 : r < 0.8 ? -1 : r < 0.9 ? 2 : -2;
  let next = lane + delta;
  if (next < 0 || next >= LANES) next = lane - delta;
  return Math.min(LANES - 1, Math.max(0, next));
}

/**
 * Builds the note chart for a session. One note per eighth-note step at most,
 * so consecutive notes are always further apart than twice the good window and
 * a tap can never be ambiguous between two notes in the same lane.
 */
export function generateChart(seed: number, difficulty: Difficulty): Note[] {
  const cfg = DIFFICULTY[difficulty];
  const rnd = mulberry32(seed);
  const step = 60000 / cfg.bpm / 2;
  const notes: Note[] = [];
  let lane = Math.floor(rnd() * LANES);
  for (let i = 0; ; i++) {
    const t = Math.round(LEAD_IN_MS + i * step);
    if (t > cfg.durationMs - TAIL_MS) break;
    if (i > 0 && rnd() > cfg.density) continue;
    if (i > 0) lane = nextLane(lane, rnd());
    notes.push({ id: notes.length, lane, t });
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface RunResult {
  score: number;
  maxCombo: number;
  /** Streak at the end of the evaluated window (drives the combo multiplier). */
  combo: number;
  perfects: number;
  goods: number;
  /** Tiles popped before the good window opened. Low credit, no life lost. */
  earlies: number;
  /** Notes that went past without a hit. */
  misses: number;
  /** Taps that did not match any note. They count against the miss limit. */
  strays: number;
  totalNotes: number;
  /** Weighted hits over all notes in the chart, 0 to 1 (perfect 1, good 0.6, early 0.25). */
  accuracy: number;
  /** False when the miss limit ended the run early. */
  completed: boolean;
  endedAtMs: number | null;
  /** Signed timing error of every hit, in ms (positive is late). */
  deltas: number[];
  /** Per-note outcome; null while unresolved. */
  grades: (Grade | null)[];
}

export function clampOffset(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) return 0;
  return Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, offsetMs));
}

/**
 * Replays a tap log against a chart. Deterministic: this is the authoritative
 * score. `offsetMs` is the player's calibrated latency, subtracted from every
 * tap. `untilMs` (in offset-adjusted time) evaluates a run in progress.
 */
export function evaluateRun(
  chart: Note[],
  taps: Tap[],
  difficulty: Difficulty,
  offsetMs = 0,
  untilMs = Infinity,
): RunResult {
  const cfg = DIFFICULTY[difficulty];
  const offset = clampOffset(offsetMs);
  const { goodMs, perfectMs } = WINDOWS;
  const earlyMs = earlyWindowMs(difficulty);

  type Ev = { time: number; kind: 0 | 1; idx: number };
  const events: Ev[] = [];
  taps.forEach((tap, idx) => events.push({ time: tap.t - offset, kind: 0, idx }));
  chart.forEach((note, idx) => events.push({ time: note.t + goodMs, kind: 1, idx }));
  // A tap exactly on the edge of a window still counts, so taps sort before expiries.
  events.sort((a, b) => a.time - b.time || a.kind - b.kind || a.idx - b.idx);

  const byLane: number[][] = Array.from({ length: LANES }, () => []);
  chart.forEach((note, idx) => byLane[note.lane].push(idx));
  const ptr: number[] = new Array(LANES).fill(0);
  const grades: (Grade | null)[] = new Array(chart.length).fill(null);
  const deltas: number[] = [];

  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let perfects = 0;
  let goods = 0;
  let earlies = 0;
  let misses = 0;
  let strays = 0;
  let endedAtMs: number | null = null;

  const fail = (time: number): boolean => {
    combo = 0;
    if (misses + strays >= cfg.maxMisses) {
      endedAtMs = time;
      return true;
    }
    return false;
  };

  for (const ev of events) {
    if (ev.time > untilMs) break;
    if (ev.kind === 0) {
      const tap = taps[ev.idx];
      const list = byLane[tap.lane];
      let noteIdx: number | undefined;
      if (list) {
        while (ptr[tap.lane] < list.length && grades[list[ptr[tap.lane]]] !== null) ptr[tap.lane]++;
        noteIdx = list[ptr[tap.lane]];
      }
      const note = noteIdx === undefined ? undefined : chart[noteIdx];
      const delta = note ? ev.time - note.t : Infinity;
      // The lowest unresolved tile in the lane is the one a tap lands on.
      if (noteIdx !== undefined && note && delta >= -earlyMs && delta <= goodMs) {
        const mult = 1 + 0.25 * Math.min(4, Math.floor(combo / 10));
        if (Math.abs(delta) <= goodMs) {
          const grade: Grade = Math.abs(delta) <= perfectMs ? 'perfect' : 'good';
          grades[noteIdx] = grade;
          deltas.push(delta);
          score += Math.round((grade === 'perfect' ? 100 : 60) * mult);
          if (grade === 'perfect') perfects++;
          else goods++;
          combo++;
          if (combo > maxCombo) maxCombo = combo;
        } else {
          // Early: the tile pops and scores a little, but the streak is untouched.
          grades[noteIdx] = 'early';
          score += Math.round(EARLY_POINTS * mult);
          earlies++;
        }
      } else {
        strays++;
        if (fail(ev.time)) break;
      }
    } else if (grades[ev.idx] === null) {
      grades[ev.idx] = 'miss';
      misses++;
      if (fail(ev.time)) break;
    }
  }

  const accuracy = chart.length ? (perfects + 0.6 * goods + EARLY_WEIGHT * earlies) / chart.length : 0;
  return {
    score,
    maxCombo,
    combo,
    perfects,
    goods,
    earlies,
    misses,
    strays,
    totalNotes: chart.length,
    accuracy,
    completed: endedAtMs === null,
    endedAtMs,
    deltas,
    grades,
  };
}

// ---------------------------------------------------------------------------
// Submission validation (server side)
// ---------------------------------------------------------------------------

export interface Submission {
  /** Rebuilt by the server from the stored seed, never taken from the client. */
  chart: Note[];
  taps: Tap[];
  difficulty: Difficulty;
  offsetMs: number;
  /** Server time between session creation and this submission. */
  serverElapsedMs: number;
}

export interface Validation {
  verdict: Verdict;
  /** Why a run was rejected. Empty unless verdict is 'rejected'. */
  reasons: string[];
  /** Why a run was flagged for review. Empty unless verdict is 'flagged'. */
  flags: string[];
  result: RunResult | null;
}

const MAX_TAPS_PER_SECOND = 14;
const MIN_SAME_LANE_GAP_MS = 45;
const CLOCK_TOLERANCE_MS = 1500;

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function rejected(reasons: string[]): Validation {
  return { verdict: 'rejected', reasons, flags: [], result: null };
}

/**
 * Structural, rate and clock checks reject a run outright. Statistical
 * signals (suspiciously uniform timing) flag it instead: the run is kept,
 * Airdrop Points are withheld and it goes to the review queue.
 */
export function validateSubmission(s: Submission): Validation {
  const cfg = DIFFICULTY[s.difficulty];
  if (!Array.isArray(s.taps)) return rejected(['malformed_taps']);
  if (s.taps.length > s.chart.length * 3 + 20) return rejected(['too_many_taps']);
  if (!Number.isFinite(s.offsetMs) || Math.abs(s.offsetMs) > OFFSET_LIMIT_MS) {
    return rejected(['offset_out_of_range']);
  }

  const reasons: string[] = [];
  let prev = -Infinity;
  const lastByLane: number[] = new Array(LANES).fill(-Infinity);
  for (const tap of s.taps) {
    if (!tap || !Number.isInteger(tap.lane) || tap.lane < 0 || tap.lane >= LANES || !Number.isFinite(tap.t)) {
      return rejected(['malformed_tap']);
    }
    if (tap.t < prev) return rejected(['taps_out_of_order']);
    if (tap.t < -500 || tap.t > cfg.durationMs + 3000) return rejected(['tap_out_of_range']);
    if (tap.t - lastByLane[tap.lane] < MIN_SAME_LANE_GAP_MS) {
      reasons.push('same_lane_gap');
      break;
    }
    lastByLane[tap.lane] = tap.t;
    prev = tap.t;
  }

  let lo = 0;
  for (let hi = 0; hi < s.taps.length; hi++) {
    while (s.taps[hi].t - s.taps[lo].t > 1000) lo++;
    if (hi - lo + 1 > MAX_TAPS_PER_SECOND) {
      reasons.push('tap_rate');
      break;
    }
  }

  const result = evaluateRun(s.chart, s.taps, s.difficulty, s.offsetMs);
  const lastTap = s.taps.length ? s.taps[s.taps.length - 1].t : 0;
  if (lastTap > s.serverElapsedMs + CLOCK_TOLERANCE_MS) reasons.push('taps_in_the_future');
  const chartEnd = s.chart.length ? s.chart[s.chart.length - 1].t + WINDOWS.goodMs : 0;
  const runLength = result.completed ? chartEnd : (result.endedAtMs ?? 0);
  if (s.serverElapsedMs < runLength - CLOCK_TOLERANCE_MS) reasons.push('run_too_fast');

  if (reasons.length) return { verdict: 'rejected', reasons, flags: [], result };

  const flags: string[] = [];
  const hits = result.perfects + result.goods;
  if (hits >= 30 && stddev(result.deltas) < 4) flags.push('uniform_timing');
  if (hits >= 40 && result.perfects / hits >= 0.97) flags.push('inhuman_accuracy');
  return { verdict: flags.length ? 'flagged' : 'accepted', reasons: [], flags, result };
}

// ---------------------------------------------------------------------------
// Rewards (server side)
// ---------------------------------------------------------------------------

export interface Reward { xp: number; coins: number; airdropPoints: number }

/**
 * Raw reward for a validated run, before the daily caps that the database
 * applies in grant_reward(). Flagged runs still earn XP and Coins but no
 * Airdrop Points until a reviewer clears them.
 */
export function rewardFor(result: RunResult, difficulty: Difficulty, verdict: Verdict): Reward {
  if (verdict === 'rejected') return { xp: 0, coins: 0, airdropPoints: 0 };
  const base = BASE_REWARD[difficulty];
  const q = Math.max(0, Math.min(1, result.accuracy));
  return {
    xp: Math.round(base.xp * q),
    coins: Math.round(base.coins * q),
    airdropPoints: verdict === 'accepted' && q >= 0.5 ? base.points : 0,
  };
}
