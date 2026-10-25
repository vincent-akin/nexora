/**
 * Boosts: consumables bought in the shop with Coins and spent when a run starts.
 *
 * One rule keeps the airdrop fair: a run that used a boost earns XP and Coins but never
 * Airdrop Points, and its score stays off the leaderboard. The database enforces both
 * (settle_game_run and the leaderboard view), so this file only describes the boosts.
 */
import type { GameKey } from './levels.ts';

export type BoostKind = 'life' | 'slow' | 'second' | 'time' | 'hint';

export const GAME_BOOSTS: Record<GameKey, BoostKind[]> = {
  beat_lanes: ['life'],
  block_drop: ['slow', 'second'],
  type_sprint: ['life', 'slow'],
  market_detective: ['time', 'hint'],
};

export const BOOST_TEXT: Record<GameKey, Partial<Record<BoostKind, { name: string; blurb: string }>>> = {
  beat_lanes: { life: { name: 'Extra hearts', blurb: '3 extra hearts' } },
  block_drop: {
    slow: { name: 'Slow drop', blurb: 'Blocks fall 30% slower' },
    second: { name: 'Second chance', blurb: 'Clears the top half once' },
  },
  type_sprint: {
    life: { name: 'Spare life', blurb: 'One extra life' },
    slow: { name: 'Slow words', blurb: 'Words fall 25% slower' },
  },
  market_detective: {
    time: { name: 'Extra time', blurb: '+10 s every round' },
    hint: { name: 'Cross out two', blurb: 'Two wrong answers crossed out' },
  },
};

export const MAX_BOOSTS_PER_RUN = 2;

export const BOOSTED_RUN_NOTE = 'Boosted run: XP and Coins are paid, but Airdrop Points are not and the score stays off the leaderboard.';

/** Keeps only boosts that exist for this game, once each, at most MAX_BOOSTS_PER_RUN. */
export function sanitizeBoosts(game: GameKey, raw: unknown): BoostKind[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(GAME_BOOSTS[game]);
  const out: BoostKind[] = [];
  for (const k of raw) if (typeof k === 'string' && allowed.has(k) && !out.includes(k as BoostKind)) out.push(k as BoostKind);
  return out.slice(0, MAX_BOOSTS_PER_RUN);
}

export const hasBoost = (boosts: readonly string[] | undefined, kind: BoostKind) => !!boosts && boosts.includes(kind);
