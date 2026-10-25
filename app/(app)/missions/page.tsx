import { createClient } from '@/lib/supabase/server';
import ClaimButton from '@/components/ClaimButton';
import LineIcon from '@/components/LineIcon';
import { QuizTask, SocialTask } from '@/components/TaskForms';

export const dynamic = 'force-dynamic';

interface Mission {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: string;
  target: number;
  daily: boolean;
  reward_xp: number;
  reward_coins: number;
  reward_points: number;
  enabled: boolean;
  params: { question?: string; options?: string[]; is_test?: boolean } | null;
}

export default async function Missions() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: missions }, { data: claims }, { data: refs }, { data: subs }] = await Promise.all([
    supabase.from('missions')
      .select('id,slug,title,description,kind,target,daily,reward_xp,reward_coins,reward_points,enabled,params')
      .order('sort_order'),
    supabase.from('mission_claims').select('mission_id,claim_key'),
    supabase.from('referrals').select('status'),
    supabase.from('social_submissions').select('mission_id,period_key,status,review_note'),
  ]);
  const all = (missions ?? []) as Mission[];
  const claimed = new Set((claims ?? []).map((c) => `${c.mission_id}:${c.claim_key}`));
  const approvedRefs = (refs ?? []).filter((r) => r.status === 'approved').length;
  const subFor = (m: Mission) => (subs ?? []).find((s) => s.mission_id === m.id && s.period_key === (m.daily ? today : 'once'));

  const card = (m: Mission) => {
    const key = m.daily ? today : 'once';
    const done = claimed.has(`${m.id}:${key}`);
    const reward = `${m.reward_xp ? `${m.reward_xp} XP, ` : ''}${m.reward_coins ? `${m.reward_coins} Coins, ` : ''}${m.reward_points} Airdrop Point${m.reward_points === 1 ? '' : 's'}`;
    const sub = m.kind === 'social_x' ? subFor(m) : undefined;

    let action: React.ReactNode;
    if (m.kind === 'social_x') {
      action = <SocialTask missionId={m.id} status={(sub?.status as 'pending' | 'approved' | 'rejected') ?? null} note={sub?.review_note} />;
    } else if (m.kind === 'stocks_quiz') {
      action = <QuizTask missionId={m.id} question={m.params?.question ?? m.title} options={m.params?.options ?? []} done={done} isTest={m.params?.is_test} />;
    } else if (m.kind === 'token_purchase' || !m.enabled) {
      action = <span className="pill locked"><LineIcon name="lock" size={12} /> Coming soon</span>;
    } else if (m.kind === 'referrals') {
      action = (
        <>
          <div className="progress" role="progressbar" aria-valuenow={Math.min(approvedRefs, m.target)} aria-valuemin={0} aria-valuemax={m.target} aria-label="Friends referred"><span style={{ width: `${Math.min(100, (approvedRefs / m.target) * 100)}%` }} /></div>
          <p className="notice">{Math.min(approvedRefs, m.target)} of {m.target} friends referred. <a href="/referrals">Get your link</a></p>
          <ClaimButton url="/api/missions/claim" body={{ missionId: m.id }} label={done ? 'Claimed' : 'Claim reward'} disabled={done} title="Milestone reached" />
        </>
      );
    } else {
      action = <ClaimButton url="/api/missions/claim" body={{ missionId: m.id }} label={done ? 'Claimed' : 'Claim reward'} disabled={done} title="Task complete" />;
    }

    return (
      <section className="card" key={m.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2>{m.title}</h2>
          <span className="notice">Reward: {reward}</span>
        </div>
        <p className="dim">{m.description}</p>
        {action}
      </section>
    );
  };

  const daily = all.filter((m) => m.daily);
  const milestones = all.filter((m) => !m.daily);

  return (
    <main className="page">
      <section className="page-head">
        <h1>Tasks</h1>
        <p className="dim">Complete tasks to earn XP, Coins and Airdrop Points. Game tasks complete from validated runs. Tweets are reviewed by a person before they pay out.</p>
      </section>
      <h2 style={{ marginBottom: -8 }}>Daily tasks <span className="notice">Reset at 00:00 UTC</span></h2>
      {daily.map(card)}
      <h2 style={{ marginBottom: -8 }}>Milestones</h2>
      {milestones.map(card)}
    </main>
  );
}
