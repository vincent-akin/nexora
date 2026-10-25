import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Effect = Record<string, unknown>;
export interface Equipped { skin?: Effect; sound?: Effect }

/** The skin and sound pack the signed-in player has equipped for one game. Uses the player's own session (RLS). */
export async function equippedFor(supabase: SupabaseClient, game: string): Promise<Equipped> {
  const { data } = await supabase.from('player_equipped').select('category,shop_items(effect)').eq('game', game);
  const out: Equipped = {};
  for (const row of data ?? []) {
    const item = Array.isArray(row.shop_items) ? row.shop_items[0] : row.shop_items;
    if (item?.effect && (row.category === 'skin' || row.category === 'sound')) out[row.category as 'skin' | 'sound'] = item.effect as Effect;
  }
  return out;
}
