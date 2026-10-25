/**
 * Block Drop core: colourful falling blocks that speed up with every level.
 *
 * Deterministic and pure. The browser runs this simulation live (it is how the screen knows what is
 * where), and the server replays the player's action log through the same class to decide the result.
 * The client never sends a score. Same model as Type Sprint and Beat Lanes.
 */
import { mulberry32 } from '../beat-lanes/core.ts';
import { GAMES, clampLevel, scaleReward, tierFor, type Tier } from '../levels.ts';
import { hasBoost, type BoostKind } from '../boosts.ts';

export type BlockVerdict = 'accepted' | 'flagged' | 'rejected';
export interface BlockSpec { level: number; boosts: BoostKind[] }

export const BLOCK_MAX_LEVEL = GAMES.block_drop.maxLevel;
export const BLOCK_MIN_LEVEL = GAMES.block_drop.minAccountLevel;
export const COLS = 10;
export const ROWS = 20;
/** Lines to clear before the level goes up (and the blocks fall faster). */
export const LINES_PER_LEVEL = 8;
export const RUN_CAP_MS = 150_000;
export const LEAD_MS = 1000;

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** Colour index on the board: 1 to 7, in the order of PIECES. 0 is empty. */
export const COLOUR_OF: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

const BASE: Record<PieceType, { n: number; cells: [number, number][] }> = {
  I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

/** The four cells of a piece in rotation `rot` (0 to 3), relative to its box. */
export function shapeOf(type: PieceType, rot: number): [number, number][] {
  const { n, cells } = BASE[type];
  if (type === 'O') return cells;
  let out = cells;
  for (let r = 0; r < ((rot % 4) + 4) % 4; r++) out = out.map(([x, y]) => [n - 1 - y, x] as [number, number]);
  return out;
}

export type Board = number[][];
export const emptyBoard = (): Board => Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

export function collides(board: Board, type: PieceType, rot: number, x: number, y: number): boolean {
  for (const [cx, cy] of shapeOf(type, rot)) {
    const bx = x + cx, by = y + cy;
    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
    if (by >= 0 && board[by][bx] !== 0) return true;
  }
  return false;
}

export const gravityMs = (level: number, boosts: readonly BoostKind[] = []) =>
  Math.round(Math.max(60, 880 * 0.8 ** (clampLevel(level, BLOCK_MAX_LEVEL) - 1)) / (hasBoost(boosts, 'slow') ? 0.7 : 1));

export const blockTier = (level: number): Tier => tierFor(level, BLOCK_MAX_LEVEL);

/** One player action. `t` is ms since the run started (client clock). */
export type ActionCode = 'L' | 'R' | 'CW' | 'CCW' | 'SD' | 'HD' | 'H';
export const ACTION_CODES: readonly ActionCode[] = ['L', 'R', 'CW', 'CCW', 'SD', 'HD', 'H'];
export interface Action { a: ActionCode; t: number }

export interface ActivePiece { type: PieceType; rot: number; x: number; y: number }

export type BlockEvent =
  | { type: 'lock'; t: number; cells: [number, number][]; colour: number }
  | { type: 'clear'; t: number; rows: number[]; lines: number; combo: number; points: number }
  | { type: 'level'; t: number; level: number }
  | { type: 'second'; t: number }
  | { type: 'end'; t: number; reason: 'topout' | 'time' };

const LINE_POINTS = [0, 100, 300, 500, 800];

export class BlockSim {
  readonly seed: number;
  readonly spec: BlockSpec;
  readonly startLevel: number;
  board: Board = emptyBoard();
  piece!: ActivePiece;
  hold: PieceType | null = null;
  private holdUsed = false;
  queue: PieceType[] = [];
  score = 0;
  lines = 0;
  pieces = 0;
  combo = -1;
  bestCombo = 0;
  maxLines = 0;
  ended = false;
  endedAt: number | null = null;
  endReason: 'topout' | 'time' | null = null;
  secondUsed = false;
  now = 0;
  events: BlockEvent[] = [];
  private rnd: () => number;
  private nextDropT = LEAD_MS;

  constructor(seed: number, spec: BlockSpec) {
    this.seed = seed;
    this.spec = { level: clampLevel(spec.level, BLOCK_MAX_LEVEL), boosts: [...spec.boosts] };
    this.startLevel = this.spec.level;
    this.rnd = mulberry32(seed);
    this.fill();
    this.spawn(this.queue.shift()!, LEAD_MS);
  }

  get level(): number { return clampLevel(this.startLevel + Math.floor(this.lines / LINES_PER_LEVEL), BLOCK_MAX_LEVEL); }
  get interval(): number { return gravityMs(this.level, this.spec.boosts); }
  drain(): BlockEvent[] { const e = this.events; this.events = []; return e; }

  /** The upcoming pieces come from a shuffled bag of all seven, so no piece goes missing for long. */
  private fill() {
    while (this.queue.length < 6) {
      const bag = [...PIECES];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      this.queue.push(...bag);
    }
  }

  private spawn(type: PieceType, t: number): boolean {
    this.piece = { type, rot: 0, x: 3, y: type === 'I' ? -1 : 0 };
    this.holdUsed = false;
    this.nextDropT = t + this.interval;
    if (collides(this.board, type, 0, this.piece.x, this.piece.y)) {
      if (hasBoost(this.spec.boosts, 'second') && !this.secondUsed) {
        // Second chance: sweep away the top half of the stack, once, and carry on.
        this.secondUsed = true;
        for (let y = 0; y < ROWS / 2; y++) this.board[y].fill(0);
        this.events.push({ type: 'second', t });
        return !collides(this.board, type, 0, this.piece.x, this.piece.y) || (this.finish(t, 'topout'), false);
      }
      this.finish(t, 'topout');
      return false;
    }
    return true;
  }

  private finish(t: number, reason: 'topout' | 'time') {
    if (this.ended) return;
    this.ended = true; this.endedAt = t; this.endReason = reason;
    this.events.push({ type: 'end', t, reason });
  }

  private lockPiece(t: number) {
    const p = this.piece;
    const colour = COLOUR_OF[p.type];
    const cells = shapeOf(p.type, p.rot).map(([cx, cy]) => [p.x + cx, p.y + cy] as [number, number]);
    for (const [x, y] of cells) if (y >= 0) this.board[y][x] = colour;
    this.pieces++;
    this.events.push({ type: 'lock', t, cells, colour });

    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) if (this.board[y].every((c) => c !== 0)) full.push(y);
    if (full.length) {
      const before = this.level;
      this.board = this.board.filter((_, y) => !full.includes(y));
      while (this.board.length < ROWS) this.board.unshift(new Array(COLS).fill(0));
      this.lines += full.length;
      this.combo++;
      if (this.combo > this.bestCombo) this.bestCombo = this.combo;
      const points = LINE_POINTS[full.length] * before + (this.combo > 0 ? 50 * this.combo * before : 0);
      this.score += points;
      this.events.push({ type: 'clear', t, rows: full, lines: full.length, combo: this.combo, points });
      if (this.level > before) this.events.push({ type: 'level', t, level: this.level });
    } else this.combo = -1;

    this.fill();
    this.spawn(this.queue.shift()!, t);
  }

  /** Moves the clock forward: gravity pulls the piece down, and a long run ends at the cap. */
  advance(t: number) {
    if (t > this.now) this.now = t;
    while (!this.ended && this.nextDropT <= t && this.nextDropT < RUN_CAP_MS) {
      const at = this.nextDropT;
      const p = this.piece;
      if (!collides(this.board, p.type, p.rot, p.x, p.y + 1)) { p.y++; this.nextDropT = at + this.interval; }
      else this.lockPiece(at);
    }
    if (!this.ended && t >= RUN_CAP_MS) this.finish(RUN_CAP_MS, 'time');
  }

  /** One player action at time t. Returns false if it did nothing. */
  act(a: ActionCode, t: number): boolean {
    this.advance(t);
    if (this.ended) return false;
    const p = this.piece;
    switch (a) {
      case 'L': case 'R': {
        const dx = a === 'L' ? -1 : 1;
        if (collides(this.board, p.type, p.rot, p.x + dx, p.y)) return false;
        p.x += dx; return true;
      }
      case 'CW': case 'CCW': {
        const rot = (p.rot + (a === 'CW' ? 1 : 3)) % 4;
        for (const dx of [0, -1, 1, -2, 2]) {
          if (!collides(this.board, p.type, rot, p.x + dx, p.y)) { p.rot = rot; p.x += dx; return true; }
        }
        return false;
      }
      case 'SD':
        if (collides(this.board, p.type, p.rot, p.x, p.y + 1)) return false;
        p.y++; this.score += 1; this.nextDropT = t + this.interval; return true;
      case 'HD': {
        let n = 0;
        while (!collides(this.board, p.type, p.rot, p.x, p.y + 1)) { p.y++; n++; }
        this.score += 2 * n;
        this.lockPiece(t);
        return true;
      }
      case 'H': {
        if (this.holdUsed) return false;
        const held = this.hold;
        this.hold = p.type;
        this.fill();
        const next = held ?? this.queue.shift()!;
        const used = true;
        if (this.spawn(next, t)) this.holdUsed = used;
        return true;
      }
    }
  }

  /** Where the current piece would land. Used for the ghost outline. */
  ghostY(): number {
    const p = this.piece;
    let y = p.y;
    while (!collides(this.board, p.type, p.rot, p.x, y + 1)) y++;
    return y;
  }
}

export interface BlockSummary {
  score: number; lines: number; pieces: number; bestCombo: number;
  startLevel: number; reachedLevel: number;
  endedAt: number; endReason: 'topout' | 'time';
  /** Pieces locked per second over the run. */
  pps: number;
}

export function summarize(sim: BlockSim): BlockSummary {
  const at = sim.endedAt ?? RUN_CAP_MS;
  return {
    score: sim.score, lines: sim.lines, pieces: sim.pieces, bestCombo: sim.bestCombo,
    startLevel: sim.startLevel, reachedLevel: sim.level, endedAt: at, endReason: sim.endReason ?? 'time',
    pps: sim.pieces / (Math.max(10_000, at) / 1000),
  };
}

/** Replays a whole action log and runs the clock to the end of the run. */
export function simulate(seed: number, spec: BlockSpec, actions: Action[]): BlockSummary {
  const sim = new BlockSim(seed, spec);
  for (const x of actions) sim.act(x.a, x.t);
  sim.advance(RUN_CAP_MS);
  return summarize(sim);
}

export interface BlockValidation { verdict: BlockVerdict; reasons: string[]; flags: string[]; result: BlockSummary | null }

const MAX_ACTIONS = 6000;
const MAX_ACTIONS_PER_SECOND = 40;
const CLOCK_TOLERANCE_MS = 1500;
const reject = (reasons: string[]): BlockValidation => ({ verdict: 'rejected', reasons, flags: [], result: null });

/**
 * Structural, rate and clock checks reject a run. A pace beyond what human hands can do flags it
 * for review and withholds Airdrop Points. Key repeat makes soft-drop timing perfectly even for
 * honest players, so even timing is not a signal here.
 */
export function validateBlocks(seed: number, spec: BlockSpec, actions: Action[], serverElapsedMs: number): BlockValidation {
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) return reject(['too_many_actions']);
  let prev = -Infinity;
  for (const x of actions) {
    if (!x || !(ACTION_CODES as readonly string[]).includes(x.a) || !Number.isFinite(x.t)) return reject(['bad_action']);
    if (x.t < prev) return reject(['actions_out_of_order']);
    if (x.t < 0 || x.t > RUN_CAP_MS + 500) return reject(['action_out_of_range']);
    prev = x.t;
  }
  let lo = 0;
  for (let hi = 0; hi < actions.length; hi++) {
    while (actions[hi].t - actions[lo].t > 1000) lo++;
    if (hi - lo + 1 > MAX_ACTIONS_PER_SECOND) return reject(['action_rate']);
  }
  const last = actions.length ? actions[actions.length - 1].t : 0;
  if (last > serverElapsedMs + CLOCK_TOLERANCE_MS) return reject(['actions_in_the_future']);

  const result = simulate(seed, spec, actions);
  if (serverElapsedMs < result.endedAt - CLOCK_TOLERANCE_MS) return reject(['run_too_fast']);

  const flags: string[] = [];
  if (result.pieces >= 40 && result.pps > 4.5) flags.push('inhuman_speed');
  return { verdict: flags.length ? 'flagged' : 'accepted', reasons: [], flags, result };
}

export const BLOCK_BASE_REWARD: Record<Tier, { xp: number; coins: number; points: number }> = {
  easy: { xp: 25, coins: 12, points: 1 },
  normal: { xp: 35, coins: 18, points: 2 },
  hard: { xp: 50, coins: 28, points: 3 },
};

/** 0 to 1: how much of a decent run (20 lines) the player cleared. */
export const blockQuality = (r: BlockSummary) => Math.max(0, Math.min(1, r.lines / 20));

export interface BlockReward { xp: number; coins: number; airdropPoints: number }

export function blockRewardFor(r: BlockSummary, spec: BlockSpec, verdict: BlockVerdict): BlockReward {
  if (verdict === 'rejected') return { xp: 0, coins: 0, airdropPoints: 0 };
  const base = BLOCK_BASE_REWARD[blockTier(spec.level)];
  const q = blockQuality(r);
  return scaleReward(
    { xp: Math.round(base.xp * q), coins: Math.round(base.coins * q), airdropPoints: verdict === 'accepted' && q >= 0.5 ? base.points : 0 },
    spec.level, spec.boosts.length > 0,
  );
}

export const blockStars = (r: BlockSummary) => (r.lines >= 24 ? 3 : r.lines >= 12 ? 2 : r.lines >= 4 ? 1 : 0);

/** The level to unlock after a run: the highest level the player actually reached. */
export const blockUnlocks = (r: BlockSummary) => (r.reachedLevel > r.startLevel ? r.reachedLevel : null);
