import { createClient } from '@/lib/supabase/server';
import ClaimButton from '@/components/ClaimButton';

export const dynamic = 'force-dynamic';

export default async function Missions() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: missions }, { data: claims }] = await Promise.all([
    supabase.from('missions').select('id,title,description,daily,reward_xp,reward_coins,reward_points').order('sort_order'),
    supabase.from('mission_claims').select('mission_id,claim_key'),
  ]);
  const claimed = new Set((claims ?? []).map((c) => `${c.mission_id}:${c.claim_key}`));

  return (
    <main className="page">
      <div>
        <h1>Missions</h1>
        <p className="dim">Missions complete from validated game results. Claim once you have met the goal.</p>
      </div>
      {(missions ?? []).map((m) => {
        const key = m.daily ? today : 'once';
        const done = claimed.has(`${m.id}:${key}`);
        return (
          <section className="card" key={m.id}>
            <h2>{m.title}</h2>
            <p className="dim">{m.description}</p>
            <p className="notice">
              Reward: {m.reward_xp} XP, {m.reward_coins} Coins{m.reward_points ? `, ${m.reward_points} Airdrop Points` : ''}. {m.daily ? 'Resets daily (UTC).' : 'One time.'}
            </p>
            <ClaimButton url="/api/missions/claim" body={{ missionId: m.id }} label={done ? 'Claimed' : 'Claim reward'} disabled={done} />
          </section>
        );
      })}
    </main>
  );
}
