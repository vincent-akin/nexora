/**
 * Level ladders, shared by every game. Each game has its own ladder of levels. A player may
 * start any level up to the highest one they have unlocked, and the server decides when a
 * level unlocks (after it has validated a run). Pure module: safe in the browser and on the server.
 */
export type GameKey = 'beat_lanes' | 'block_drop' | 'type_sprint' | 'market_detective';
export type Tier = 'easy' | 'normal' | 'hard';

export interface GameInfo {
  key: GameKey;
  slug: string;
  label: string;
  /** Highest level on the ladder. */
  maxLevel: number;
  /** Player (account) level needed to open the game at all. */
  minAccountLevel: number;
}

export const GAMES: Record<GameKey, GameInfo> = {
  beat_lanes: { key: 'beat_lanes', slug: 'beat-lanes', label: 'Beat Lanes', maxLevel: 10, minAccountLevel: 1 },
  block_drop: { key: 'block_drop', slug: 'block-drop', label: 'Block Drop', maxLevel: 15, minAccountLevel: 2 },
  type_sprint: { key: 'type_sprint', slug: 'type-sprint', label: 'Type Sprint', maxLevel: 12, minAccountLevel: 3 },
  market_detective: { key: 'market_detective', slug: 'market-detective', label: 'Market Detective', maxLevel: 10, minAccountLevel: 4 },
};

export const GAME_KEYS = Object.keys(GAMES) as GameKey[];

export const clampLevel = (level: number, max: number) => Math.max(1, Math.min(max, Math.floor(Number.isFinite(level) ? level : 1)));

/** The reward tier for a level: the bottom third is easy, the middle third normal, the top third hard. */
export function tierFor(level: number, max: number): Tier {
  const f = (clampLevel(level, max) - 1) / Math.max(1, max - 1);
  return f < 1 / 3 ? 'easy' : f < 2 / 3 ? 'normal' : 'hard';
}

/** XP and Coins grow with the level: +10% per level above the first. Airdrop Points stay tier-based. */
export const levelScale = (level: number) => 1 + 0.1 * (Math.max(1, level) - 1);

export interface Reward { xp: number; coins: number; airdropPoints: number }

export function scaleReward(r: Reward, level: number, boosted: boolean): Reward {
  const k = levelScale(level);
  return { xp: Math.round(r.xp * k), coins: Math.round(r.coins * k), airdropPoints: boosted ? 0 : r.airdropPoints };
}
