/**
 * Type Sprint core: words fall from the top, and the player types them before they reach the
 * bottom. Each level is a stage with its own speed and word length. Clear the stage's words
 * and the next, faster stage begins; lose every life and the run ends.
 *
 * The simulation is deterministic and pure. The browser runs it live (it is how the screen knows
 * where each word is), and the server replays the player's keystroke log through the very same
 * class to decide the result. The client never sends a score.
 */
import { mulberry32 } from '../beat-lanes/core.ts';
import { GAMES, clampLevel, scaleReward, tierFor, type Tier } from '../levels.ts';
import { hasBoost, type BoostKind } from '../boosts.ts';
import { WORD_POOL } from './words.ts';

export type SprintVerdict = 'accepted' | 'flagged' | 'rejected';
export interface SprintSpec { level: number; boosts: BoostKind[] }

export const SPRINT_MAX_LEVEL = GAMES.type_sprint.maxLevel;
export const SPRINT_MIN_LEVEL = GAMES.type_sprint.minAccountLevel;
/** A run never lasts longer than this, so a good player cannot hold a session open forever. */
export const RUN_CAP_MS = 150_000;
/** Time before the first word appears, and the breather between stages. */
export const LEAD_MS = 1500;
export const STAGE_PAUSE_MS = 1400;

export const CORRECT_POINTS = 10;
export const ERROR_PENALTY = 5;
export const MISS_PENALTY = 10;
export const STAGE_BONUS = 100;

export interface LevelConfig {
  /** Time a word takes to fall from the top of the screen to the bottom. */
  fallMs: number;
  /** Time between one word appearing and the next. */
  gapMs: number;
  /** Words in the stage. */
  quota: number;
  minLen: number;
  maxLen: number;
  lives: number;
}

/**
 * The ladder, in the spirit of a typing tutor: every level is a little faster and the words a
 * little longer. Level 1 is four-letter words falling for nine seconds; level 12 is nine to
 * thirteen letters in just over three.
 */
export function sprintConfig(level: number, boosts: readonly BoostKind[] = []): LevelConfig {
  const L = clampLevel(level, SPRINT_MAX_LEVEL);
  const minLen = 4 + Math.floor((L - 1) / 2);
  return {
    fallMs: Math.round(Math.max(3200, 9000 - 540 * (L - 1)) / (hasBoost(boosts, 'slow') ? 0.75 : 1)),
    gapMs: 3200 - 150 * (L - 1),
    quota: 8 + L,
    minLen,
    maxLen: minLen + 2 + (L >= 11 ? 2 : 0),
    lives: 3 + (hasBoost(boosts, 'life') ? 1 : 0),
  };
}

export const sprintTier = (level: number): Tier => tierFor(level, SPRINT_MAX_LEVEL);

const RARE = /[jqxzkvwy]/;
/** Words that fit a level's length range. From level 7 on, words with awkward letters come up more often. */
export function wordsFor(level: number): string[] {
  const { minLen, maxLen } = sprintConfig(level);
  return WORD_POOL.filter((w) => w.length >= minLen && w.length <= maxLen);
}

export interface WordSpec { text: string; /** 0 to 1: where the word sits across the screen. Visual only. */ x: number }

/** The words of one stage. The same seed, level and stage always give the same list. */
export function stageWords(seed: number, level: number, stage: number): WordSpec[] {
  const { quota } = sprintConfig(level);
  const rnd = mulberry32(((seed ^ Math.imul(stage + 1, 0x9e3779b1)) >>> 0));
  const pool = wordsFor(level);
  const used = new Set<string>();
  const recent: string[] = [];
  const out: WordSpec[] = [];
  while (out.length < quota) {
    // Neighbouring words never start with the same letter, so a first keystroke is never ambiguous.
    let cands = pool.filter((w) => !used.has(w) && !recent.includes(w[0]));
    if (!cands.length) cands = pool.filter((w) => !recent.includes(w[0]));
    if (!cands.length) cands = pool;
    const weights = cands.map((w) => (level >= 7 && RARE.test(w) ? 2 : 1));
    let r = rnd() * weights.reduce((a, b) => a + b, 0);
    let pick = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) { pick = cands[i]; break; } }
    used.add(pick);
    recent.push(pick[0]);
    if (recent.length > 2) recent.shift();
    out.push({ text: pick, x: Math.round((0.06 + rnd() * 0.7) * 1000) / 1000 });
  }
  return out;
}

export interface WordInst extends WordSpec {
  stage: number;
  index: number;
  spawnT: number;
  fallMs: number;
  /** The time the word reaches the bottom. */
  dieT: number;
  typed: number;
  status: 'falling' | 'done' | 'missed';
}

export type SprintEvent =
  | { type: 'hit'; t: number; word: WordInst; streak: number }
  | { type: 'err'; t: number; word: WordInst | null }
  | { type: 'word'; t: number; word: WordInst; points: number }
  | { type: 'miss'; t: number; word: WordInst; lives: number }
  | { type: 'stage'; t: number; cleared: number; level: number; bonus: number }
  | { type: 'end'; t: number; reason: 'lives' | 'time' };

/** One keystroke: the letter and ms since the run started (client clock). */
export interface Key { c: string; t: number }

export class SprintSim {
  readonly seed: number;
  readonly spec: SprintSpec;
  readonly startLevel: number;
  score = 0;
  streak = 0;
  bestStreak = 0;
  correct = 0;
  errors = 0;
  wordsDone = 0;
  missed = 0;
  lives: number;
  stage = 0;
  stagesCleared = 0;
  ended = false;
  endedAt: number | null = null;
  endReason: 'lives' | 'time' | null = null;
  words: WordInst[] = [];
  locked: WordInst | null = null;
  /** Things that happened since the last drain(): the screen uses them for animation and sound. */
  events: SprintEvent[] = [];
  /** The latest time the simulation has been advanced to. */
  now = 0;
  private resolved = 0;

  constructor(seed: number, spec: SprintSpec) {
    this.seed = seed;
    this.spec = { level: clampLevel(spec.level, SPRINT_MAX_LEVEL), boosts: [...spec.boosts] };
    this.startLevel = this.spec.level;
    this.lives = sprintConfig(this.startLevel, this.spec.boosts).lives;
    this.openStage(LEAD_MS);
  }

  /** The level of the stage in play. It stops rising at the top of the ladder. */
  get level(): number { return clampLevel(this.startLevel + this.stage, SPRINT_MAX_LEVEL); }

  drain(): SprintEvent[] { const e = this.events; this.events = []; return e; }

  private openStage(startAt: number) {
    const cfg = sprintConfig(this.level, this.spec.boosts);
    this.words = stageWords(this.seed, this.level, this.stage).map((w, i) => {
      const spawnT = startAt + i * cfg.gapMs;
      return { ...w, stage: this.stage, index: i, spawnT, fallMs: cfg.fallMs, dieT: spawnT + cfg.fallMs, typed: 0, status: 'falling' as const };
    });
    this.resolved = 0;
    this.locked = null;
  }

  private end(t: number, reason: 'lives' | 'time') {
    if (this.ended) return;
    this.ended = true; this.endedAt = t; this.endReason = reason; this.locked = null;
    this.events.push({ type: 'end', t, reason });
  }

  private afterResolve(t: number) {
    if (this.resolved < this.words.length) return;
    this.stagesCleared++;
    const bonus = STAGE_BONUS * this.level;
    this.score += bonus;
    this.stage++;
    this.events.push({ type: 'stage', t, cleared: this.stagesCleared, level: this.level, bonus });
    this.openStage(t + STAGE_PAUSE_MS);
  }

  /** Moves the clock forward: words that reach the bottom cost a life, and a long wait ends the run. */
  advance(t: number) {
    if (t > this.now) this.now = t;
    while (!this.ended) {
      let next: WordInst | null = null;
      for (const w of this.words) if (w.status === 'falling' && (!next || w.dieT < next.dieT)) next = w;
      if (!next || next.dieT > t || next.dieT >= RUN_CAP_MS) break;
      next.status = 'missed';
      this.missed++; this.lives--; this.streak = 0;
      this.score = Math.max(0, this.score - MISS_PENALTY);
      if (this.locked === next) this.locked = null;
      this.resolved++;
      this.events.push({ type: 'miss', t: next.dieT, word: next, lives: this.lives });
      if (this.lives <= 0) { this.end(next.dieT, 'lives'); return; }
      this.afterResolve(next.dieT);
    }
    if (!this.ended && t >= RUN_CAP_MS) this.end(RUN_CAP_MS, 'time');
  }

  private err(t: number, word: WordInst | null) {
    this.errors++; this.streak = 0;
    this.score = Math.max(0, this.score - ERROR_PENALTY);
    this.events.push({ type: 'err', t, word });
  }

  /** One keystroke at time t. A key picks the lowest falling word that starts with it, then must follow that word. */
  press(c: string, t: number) {
    if (this.ended) return;
    this.advance(t);
    if (this.ended) return;
    let target = this.locked;
    if (!target) {
      for (const w of this.words) {
        if (w.status === 'falling' && w.spawnT <= t && w.text[0] === c && (!target || w.spawnT < target.spawnT)) target = w;
      }
    }
    if (!target) { this.err(t, null); return; }
    if (target.text[target.typed] !== c) { this.err(t, target); return; }

    this.locked = target;
    target.typed++;
    this.correct++;
    const mult = 1 + 0.25 * Math.min(4, Math.floor(this.streak / 10));
    this.score += Math.round(CORRECT_POINTS * mult);
    this.streak++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    this.events.push({ type: 'hit', t, word: target, streak: this.streak });
    if (target.typed === target.text.length) {
      const points = Math.round((20 + 5 * target.text.length) * (1 + 0.1 * (this.level - 1)));
      this.score += points;
      this.wordsDone++;
      target.status = 'done';
      this.locked = null;
      this.resolved++;
      this.events.push({ type: 'word', t, word: target, points });
      this.afterResolve(t);
    }
  }
}

export interface SprintSummary {
  score: number; correct: number; errors: number; wordsDone: number; missed: number;
  stagesCleared: number; bestStreak: number;
  /** Correct keys over all keys, 0 to 1. */
  accuracy: number;
  wpm: number;
  startLevel: number; reachedLevel: number;
  endedAt: number; endReason: 'lives' | 'time';
}

/** Plays a whole keystroke log and runs the clock to the end of the run. */
export function simulate(seed: number, spec: SprintSpec, keys: Key[]): SprintSummary {
  const sim = new SprintSim(seed, spec);
  for (const k of keys) sim.press(k.c, k.t);
  sim.advance(RUN_CAP_MS);
  return summarize(sim);
}

export function summarize(sim: SprintSim): SprintSummary {
  const at = sim.endedAt ?? RUN_CAP_MS;
  const total = sim.correct + sim.errors;
  return {
    score: sim.score, correct: sim.correct, errors: sim.errors, wordsDone: sim.wordsDone, missed: sim.missed,
    stagesCleared: sim.stagesCleared, bestStreak: sim.bestStreak,
    accuracy: total ? sim.correct / total : 0,
    wpm: sim.correct / 5 / (Math.max(10_000, at) / 60_000),
    startLevel: sim.startLevel, reachedLevel: sim.level,
    endedAt: at, endReason: sim.endReason ?? 'time',
  };
}

export interface SprintValidation { verdict: SprintVerdict; reasons: string[]; flags: string[]; result: SprintSummary | null }

const MAX_KEYS = 3000;
const MAX_KEYS_PER_SECOND = 22;
const MIN_KEY_GAP_MS = 8;
const CLOCK_TOLERANCE_MS = 1500;

function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

const reject = (reasons: string[]): SprintValidation => ({ verdict: 'rejected', reasons, flags: [], result: null });

/**
 * Structural, rate and clock checks reject a run. Statistical signals (near perfectly even key
 * timing, or speeds beyond the fastest human typists) flag it for review and withhold Airdrop
 * Points. The run must also have lasted as long as the replay says it did.
 */
export function validateSprint(seed: number, spec: SprintSpec, keys: Key[], serverElapsedMs: number): SprintValidation {
  if (!Array.isArray(keys) || keys.length > MAX_KEYS) return reject(['too_many_keys']);
  let prev = -Infinity;
  for (const k of keys) {
    if (!k || typeof k.c !== 'string' || !/^[a-z]$/.test(k.c) || !Number.isFinite(k.t)) return reject(['bad_key']);
    if (k.t < prev) return reject(['keys_out_of_order']);
    if (k.t < 0 || k.t > RUN_CAP_MS + 500) return reject(['key_out_of_range']);
    if (k.t - prev < MIN_KEY_GAP_MS) return reject(['key_gap']);
    prev = k.t;
  }
  let lo = 0;
  for (let hi = 0; hi < keys.length; hi++) {
    while (keys[hi].t - keys[lo].t > 1000) lo++;
    if (hi - lo + 1 > MAX_KEYS_PER_SECOND) return reject(['key_rate']);
  }
  const last = keys.length ? keys[keys.length - 1].t : 0;
  if (last > serverElapsedMs + CLOCK_TOLERANCE_MS) return reject(['keys_in_the_future']);

  const result = simulate(seed, spec, keys);
  if (serverElapsedMs < result.endedAt - CLOCK_TOLERANCE_MS) return reject(['run_too_fast']);

  const flags: string[] = [];
  if (keys.length >= 60) {
    const gaps = keys.slice(1).map((k, i) => k.t - keys[i].t);
    if (spread(gaps) < 10) flags.push('uniform_timing');
  }
  if (result.wpm >= 170) flags.push('inhuman_speed');
  return { verdict: flags.length ? 'flagged' : 'accepted', reasons: [], flags, result };
}

export const SPRINT_BASE_REWARD: Record<Tier, { xp: number; coins: number; points: number }> = {
  easy: { xp: 20, coins: 10, points: 1 },
  normal: { xp: 30, coins: 16, points: 2 },
  hard: { xp: 45, coins: 26, points: 3 },
};

/** 0 to 1: accuracy, scaled down until the player has cleared the first stage's worth of words. */
export function sprintQuality(r: SprintSummary): number {
  const target = sprintConfig(r.startLevel).quota;
  return Math.max(0, Math.min(1, r.accuracy * Math.min(1, r.wordsDone / target)));
}

export interface SprintReward { xp: number; coins: number; airdropPoints: number }

export function sprintRewardFor(r: SprintSummary, spec: SprintSpec, verdict: SprintVerdict): SprintReward {
  if (verdict === 'rejected') return { xp: 0, coins: 0, airdropPoints: 0 };
  const base = SPRINT_BASE_REWARD[sprintTier(spec.level)];
  const q = sprintQuality(r);
  return scaleReward(
    { xp: Math.round(base.xp * q), coins: Math.round(base.coins * q), airdropPoints: verdict === 'accepted' && q >= 0.5 ? base.points : 0 },
    spec.level, spec.boosts.length > 0,
  );
}

/** Stars for the results screen: one for each stage cleared, up to three. */
export const sprintStars = (r: SprintSummary) => Math.min(3, r.stagesCleared);

/** The level to unlock after a run: the one above the highest stage cleared. */
export const sprintUnlocks = (r: SprintSummary) => (r.stagesCleared > 0 ? Math.min(SPRINT_MAX_LEVEL, r.startLevel + r.stagesCleared) : null);
