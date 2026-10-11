import type { Difficulty } from './core.ts';

/** Minimum player level for each difficulty. Matches level_config in the seed data. */
export const DIFFICULTY_MIN_LEVEL: Record<Difficulty, number> = { easy: 1, normal: 1, hard: 3 };

export interface LevelRow { level: number; name: string; xp_required: number }

/** Current level for an XP total, from the level_config rows. */
export function levelForXp(xp: number, levels: LevelRow[]): LevelRow {
  const sorted = [...levels].sort((a, b) => a.xp_required - b.xp_required);
  let current = sorted[0];
  for (const l of sorted) if (xp >= l.xp_required) current = l;
  return current;
}

export function nextLevel(xp: number, levels: LevelRow[]): LevelRow | null {
  const sorted = [...levels].sort((a, b) => a.xp_required - b.xp_required);
  return sorted.find((l) => l.xp_required > xp) ?? null;
}
