import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoostKind } from '@/lib/boosts';
import { GAMES, type GameKey } from '@/lib/levels';
import { GAME_BOOSTS } from '@/lib/boosts';

export interface GameProgress {
  /** Highest level the player may start. */
  unlocked: number;
  /** Boosts the player owns for this game, by kind. */
  boosts: Partial<Record<BoostKind, number>>;
}

/** The signed-in player's progress in one game, read through their own session (row level security). */
export async function loadProgress(supabase: SupabaseClient, game: GameKey, practice = false): Promise<GameProgress> {
  // Practice mode (admins): every level is open and every boost is available. Nothing is spent.
  if (practice) return { unlocked: GAMES[game].maxLevel, boosts: Object.fromEntries(GAME_BOOSTS[game].map((k) => [k, 99])) };
  const [{ data: lv }, { data: items }] = await Promise.all([
    supabase.from('player_game_levels').select('unlocked').eq('game', game).maybeSingle(),
    supabase.from('player_items').select('quantity,shop_items(game,category,effect)'),
  ]);
  const boosts: GameProgress['boosts'] = {};
  for (const row of items ?? []) {
    const it = (Array.isArray(row.shop_items) ? row.shop_items[0] : row.shop_items) as { game: string; category: string; effect: { type?: string; kind?: string } } | null;
    if (it && it.game === game && it.category === 'bonus' && it.effect?.type === 'boost' && it.effect.kind && row.quantity > 0) {
      boosts[it.effect.kind as BoostKind] = row.quantity;
    }
  }
  return { unlocked: Number(lv?.unlocked ?? 1), boosts };
}
