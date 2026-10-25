import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { levelForXp, nextLevel, type LevelRow } from '@/lib/beat-lanes/progression';
import { currentStamina } from '@/lib/stamina';
import { POINTS_DISCLAIMER } from '@/lib/copy';
import ClaimButton from '@/components/ClaimButton';
import Icon from '@/components/Icon';
import LineIcon from '@/components/LineIcon';

export const dynamic = 'force-dynamic';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date();
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86400000));

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

  const last = claims?.[0];
  const claimedToday = last?.claim_date === today;
  const alive = claimedToday || last?.claim_date === yesterday; // streak still running
  const streak = alive ? Number(last?.streak ?? 0) : 0;
  const filled = streak === 0 ? 0 : ((streak - 1) % 7) + 1;

  return (
    <main className="page">
      <section className="page-head">
        <h1>Welcome back, {profile?.display_name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <span className="level-pill"><LineIcon name="trophy" size={14} /> Level {level.level} · {level.name}</span>
          <div className="progress" style={{ flex: '1 1 200px', maxWidth: 360 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next level">
            <span style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
          <span className="notice">{next ? `${xp.toLocaleString()} / ${next.xp_required.toLocaleString()} XP` : 'Top level reached'}</span>
        </div>
      </section>

      <section className="grid" aria-label="Balances">
        <div className="stat"><div className="stat-top"><span className="stat-ic xp"><Icon name="star" size={18} /></span>XP</div><span className="big">{xp.toLocaleString()}</span></div>
        <div className="stat"><div className="stat-top"><span className="stat-ic coins"><Icon name="coin" size={18} /></span>Coins</div><span className="big">{Number(bal?.coins ?? 0).toLocaleString()}</span></div>
        <div className="stat"><div className="stat-top"><span className="stat-ic gem"><Icon name="gem" size={18} /></span>Airdrop Points</div><span className="big">{Number(bal?.airdrop_points ?? 0).toLocaleString()}</span></div>
        <div className="stat">
          <div className="stat-top"><span className="stat-ic bolt"><LineIcon name="bolt" size={16} /></span>Stamina</div>
          <span className="big">{stamina.value}{cfg ? <span className="dim" style={{ fontSize: 16 }}> / {cfg.stamina_cap}</span> : null}</span>
          {stamina.secondsToNext > 0 ? <small>Next point in about {Math.ceil(stamina.secondsToNext / 60)} min</small> : <small>Full</small>}
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Daily reward</h2>
          <div className="streak" role="img" aria-label={`${filled} of 7 days in the current streak`}>
            {Array.from({ length: 7 }, (_, i) => <i key={i} className={i < filled ? (i === 6 ? 'on gold' : 'on') : ''} />)}
          </div>
          <p className="notice">{streak > 0 ? `${streak}-day streak. Miss a day and it resets to 1. Day 7 pays a bonus.` : 'Claim once a day. Consecutive days build a streak, and day 7 pays a bonus.'}</p>
          <ClaimButton url="/api/daily/claim" label={claimedToday ? 'Claimed today' : 'Claim daily reward'} disabled={claimedToday} title="Daily reward claimed" />
        </div>
        <div className="card">
          <h2>Jump back in</h2>
          <p className="dim">Beat Lanes is open. Short rhythm runs, one stamina point each.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="btn primary" href="/arena/beat-lanes"><LineIcon name="music" /> Play Beat Lanes</Link>
            <Link className="btn" href="/arena">All games</Link>
          </div>
        </div>
      </section>

      <p className="notice">{POINTS_DISCLAIMER}</p>
    </main>
  );
}
