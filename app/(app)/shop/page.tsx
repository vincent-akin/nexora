import { createClient } from '@/lib/supabase/server';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import ShopView, { type ShopItem } from '@/components/ShopView';

export const dynamic = 'force-dynamic';

export default async function Shop() {
  const supabase = await createClient();
  const [{ data: bal }, { data: levels }, { data: items }, { data: owned }, { data: eq }] = await Promise.all([
    supabase.from('player_balances').select('xp,coins').single(),
    supabase.from('level_config').select('level,name,xp_required'),
    supabase.from('shop_items').select('id,slug,name,description,category,game,price_coins,effect,consumable,min_level').order('sort_order'),
    supabase.from('player_items').select('item_id,quantity'),
    supabase.from('player_equipped').select('item_id'),
  ]);
  const level = levelForXp(Number(bal?.xp ?? 0), (levels ?? []) as LevelRow[]);
  return (
    <ShopView
      coins={Number(bal?.coins ?? 0)}
      level={level.level}
      items={(items ?? []) as ShopItem[]}
      owned={Object.fromEntries((owned ?? []).map((o) => [o.item_id, o.quantity]))}
      equipped={(eq ?? []).map((e) => e.item_id)}
    />
  );
}
