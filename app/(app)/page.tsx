import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { levelForXp, nextLevel, type LevelRow } from '@/lib/beat-lanes/progression';
import { currentStamina } from '@/lib/stamina';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import ClaimButton from '@/components/ClaimButton';
import Icon from '@/components/Icon';
import Mascot from '@/components/Mascot';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: profile }, { data: bal }, { data: stam }, { data: rules }, { data: levels }, { data: claims }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user!.id).single(),
    supabase.from('player_balances').select('xp,coins,airdrop_points').eq('user_id', user!.id).single(),
    supabase.from('player_stamina').select('stamina,updated_at').eq('user_id', user!.id).single(),
    supabase.from('rules_versions').select('config').eq('active', true).single(),
    supabase.from('level_config').select('level,name,xp_required'),
    supabase.from('daily_claims').select('claim_date,streak').order('claim_date', { ascending: false }).limit(1),
  ]);

  const xp = Number(bal?.xp ?? 0);
  const levelRows = (levels ?? []) as LevelRow[];
  const level = levelForXp(xp, levelRows);
  const next = nextLevel(xp, levelRows);
  const pct = next ? Math.round(((xp - level.xp_required) / (next.xp_required - level.xp_required)) * 100) : 100;
  const cfg = rules?.config as { stamina_cap: number; stamina_refill_seconds: number } | undefined;
  const stamina = stam && cfg ? currentStamina(stam, cfg) : { value: 0, secondsToNext: 0 };
  const lastClaim = claims?.[0];
  const claimedToday = lastClaim?.claim_date === today;

  return (
    <main className="page">
      <section className="card hero-card">
        <Mascot />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <h1>Hey, {profile?.display_name}!</h1>
          <span className="badge"><Icon name="trophy" size={18} /> Level {level.level}: {level.name}</span>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next level"><span style={{ width: `${Math.max(pct, 6)}%` }} /></div>
          <p className="notice">{next ? `${xp} of ${next.xp_required} XP to level ${next.level}` : 'Top level reached. Legend!'}</p>
        </div>
      </section>

      <section className="grid" aria-label="Balances">
        <div className="tile xp"><Icon name="star" size={52} /><div><small>XP</small><span className="big">{xp.toLocaleString()}</span></div></div>
        <div className="tile coins"><Icon name="coin" size={52} /><div><small>Coins</small><span className="big">{Number(bal?.coins ?? 0).toLocaleString()}</span></div></div>
        <div className="tile gem"><Icon name="gem" size={52} /><div><small>Airdrop Points</small><span className="big">{Number(bal?.airdrop_points ?? 0).toLocaleString()}</span></div></div>
        <div className="tile bolt">
          <Icon name="bolt" size={52} />
          <div>
            <small>Stamina</small>
            <span className="big">{stamina.value}{cfg ? `/${cfg.stamina_cap}` : ''}</span>
            {stamina.secondsToNext > 0 ? <small>Next bolt in about {Math.ceil(stamina.secondsToNext / 60)} min</small> : null}
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="card gift-wrap">
          <h2>Daily reward</h2>
          <p className="notice">{lastClaim ? `Streak: ${lastClaim.streak} day${lastClaim.streak === 1 ? '' : 's'}. Miss a day and it resets to 1.` : 'Claim once a day. Consecutive days build a streak!'}</p>
          <ClaimButton url="/api/daily/claim" label={claimedToday ? 'Claimed today' : 'Claim daily reward'} disabled={claimedToday} title="Daily reward!" bigIcon="gift" />
        </div>
        <div className="card">
          <h2>Ready to play?</h2>
          <p className="notice">Beat Lanes is open. More games arrive as you level up.</p>
          <Link className="btn primary" href="/arena"><Icon name="play" size={24} /> Open the Arena</Link>
        </div>
      </section>

      <p className="notice">{POINTS_DISCLAIMER}</p>
    </main>
  );
}
