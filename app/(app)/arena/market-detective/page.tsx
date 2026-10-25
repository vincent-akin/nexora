import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { DETECTIVE_MIN_LEVEL } from '@/lib/market-detective/core';
import { loadProgress } from '@/lib/progress';
import { isAdminSession } from '@/lib/admin';
import { currentStamina } from '@/lib/stamina';
import { equippedFor } from '@/lib/shop';
import MarketDetective from '@/components/MarketDetective';
import LineIcon from '@/components/LineIcon';

export const dynamic = 'force-dynamic';

export default async function MarketDetectivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: bal }, { data: stam }, { data: rules }, { data: levels }] = await Promise.all([
    supabase.from('player_balances').select('xp').eq('user_id', user!.id).single(),
    supabase.from('player_stamina').select('stamina,updated_at').eq('user_id', user!.id).single(),
    supabase.from('rules_versions').select('config').eq('active', true).single(),
    supabase.from('level_config').select('level,name,xp_required'),
  ]);

  const cfg = (rules?.config ?? { stamina_cap: 10, stamina_refill_seconds: 1200 }) as { stamina_cap: number; stamina_refill_seconds: number };
  const levelRows = (levels ?? []) as LevelRow[];
  const level = levelForXp(Number(bal?.xp ?? 0), levelRows);
  // Locked until the player reaches the level; the API enforces this too.
  const practice = await isAdminSession(supabase, user!.id);
  if (level.level < DETECTIVE_MIN_LEVEL && !practice) redirect('/arena');
  const stamina = stam ? currentStamina(stam, cfg).value : 0;
  const theme = await equippedFor(supabase, 'market_detective');
  const progress = await loadProgress(supabase, 'market_detective', practice);

  return (
    <main className="page">
      <div className="game-head">
        <Link href="/arena" className="back"><LineIcon name="back" /> Arena</Link>
        <span className="stamina-chip"><LineIcon name="bolt" size={14} /> {stamina} / {cfg.stamina_cap} stamina</span>
      </div>
      <MarketDetective level={level.level} xp={Number(bal?.xp ?? 0)} levels={levelRows} stamina={stamina} staminaCap={cfg.stamina_cap} theme={theme} unlocked={progress.unlocked} owned={progress.boosts} practice={practice} />
    </main>
  );
}
