import { createClient } from '@/lib/supabase/server';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { currentStamina } from '@/lib/stamina';
import BeatLanes from '@/components/BeatLanes';

export const dynamic = 'force-dynamic';

export default async function Arena() {
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
  const level = levelForXp(Number(bal?.xp ?? 0), (levels ?? []) as LevelRow[]);
  const stamina = stam ? currentStamina(stam, cfg).value : 0;

  return (
    <main className="page">
      <div>
        <h1>Arena</h1>
        <p className="dim">Each run costs one stamina point. Scores are checked on the server.</p>
      </div>
      <BeatLanes level={level.level} xp={Number(bal?.xp ?? 0)} levels={(levels ?? []) as LevelRow[]} stamina={stamina} staminaCap={cfg.stamina_cap} />
    </main>
  );
}
