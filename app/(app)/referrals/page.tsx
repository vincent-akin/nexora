import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Referrals() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';

  const [{ data: profile }, { data: refs }] = await Promise.all([
    supabase.from('profiles').select('referral_code').eq('id', user!.id).single(),
    supabase.from('referrals').select('status'),
  ]);
  const count = (s: string) => (refs ?? []).filter((r) => r.status === s).length;
  const link = `${proto}://${host}/login?ref=${profile?.referral_code}`;

  return (
    <main className="page">
      <div>
        <h1>Referrals</h1>
        <p className="dim">Invite friends. A referral counts once they verify their email and finish one accepted run.</p>
      </div>
      <section className="card">
        <h2>Your link</h2>
        <p className="linkbox">{link}</p>
        <p className="notice">Your code: {profile?.referral_code}</p>
      </section>
      <section className="grid">
        <div className="card"><span className="dim">Pending</span><span className="big">{count('pending')}</span></div>
        <div className="card"><span className="dim">Approved</span><span className="big">{count('approved')}</span></div>
      </section>
      <p className="notice">Referral rewards are reviewed and can be withheld if activity looks abusive.</p>
    </main>
  );
}
