import { createAdminClient } from '@/lib/supabase/admin';
import AdminMsg from '@/components/AdminMsg';
import { markReviewed, rejectReferral, reviewSocial } from '../actions';

const short = (id: unknown) => String(id ?? '').slice(0, 8);

export default async function Reviews({ searchParams }: { searchParams: Promise<{ msg?: string; bad?: string }> }) {
  const sp = await searchParams;
  const db = createAdminClient();
  const [{ data: flags }, { data: pending }, { data: social }, { data: ledger }] = await Promise.all([
    db.from('risk_flags').select('id,user_id,kind,detail,created_at').eq('reviewed', false).order('created_at', { ascending: false }).limit(50),
    db.from('referrals').select('id,referrer_id,referred_id,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
    db.from('social_submissions').select('id,user_id,url,created_at,missions(title)').eq('status', 'pending').order('created_at', { ascending: true }).limit(50),
    db.from('points_ledger').select('id,user_id,balance_type,amount,reason,created_at').order('created_at', { ascending: false }).limit(30),
  ]);

  return (
    <>
      <div><h1>Reviews</h1><p className="dim">Things that need a human decision. Every decision is written to the audit log.</p></div>
      <AdminMsg msg={sp.msg} bad={sp.bad} />

      <section className="adm-card scroll">
        <h2>Tweets waiting</h2>
        <p className="adm-note">Open the link, check the tweet is genuinely about the RWAINC token, then approve or reject. Approving pays the reward once.</p>
        {social && social.length ? (
          <table>
            <thead><tr><th>Submitted</th><th>Player</th><th>Task</th><th>Link</th><th>Decision</th></tr></thead>
            <tbody>{social.map((x) => (
              <tr key={x.id}>
                <td>{new Date(x.created_at).toLocaleString()}</td><td>{short(x.user_id)}</td>
                <td>{(x.missions as unknown as { title: string } | null)?.title}</td>
                <td><a href={x.url} target="_blank" rel="noopener noreferrer">Open tweet</a></td>
                <td>
                  <form action={reviewSocial} className="adm-row">
                    <input type="hidden" name="id" value={x.id} />
                    <input type="text" name="note" placeholder="Note (optional)" aria-label="Note" style={{ width: 150 }} />
                    <button className="adm-btn primary sm" type="submit" name="decision" value="approve">Approve</button>
                    <button className="adm-btn sm" type="submit" name="decision" value="reject">Reject</button>
                  </form>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="dim">No tweets waiting.</p>}
      </section>

      <section className="adm-card scroll">
        <h2>Flagged and rejected runs</h2>
        {flags && flags.length ? (
          <table>
            <thead><tr><th>When</th><th>Player</th><th>Kind</th><th>Detail</th><th /></tr></thead>
            <tbody>{flags.map((f) => (
              <tr key={f.id}>
                <td>{new Date(f.created_at).toLocaleString()}</td><td>{short(f.user_id)}</td><td><span className="adm-pill amber">{f.kind}</span></td>
                <td><code>{JSON.stringify(f.detail)}</code></td>
                <td><form action={markReviewed}><input type="hidden" name="id" value={f.id} /><button className="adm-btn sm" type="submit">Mark reviewed</button></form></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="dim">Nothing waiting for review.</p>}
      </section>

      <section className="adm-card scroll">
        <h2>Pending referrals</h2>
        {pending && pending.length ? (
          <table>
            <thead><tr><th>When</th><th>Referrer</th><th>Referred</th><th /></tr></thead>
            <tbody>{pending.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString()}</td><td>{short(r.referrer_id)}</td><td>{short(r.referred_id)}</td>
                <td><form action={rejectReferral}><input type="hidden" name="id" value={r.id} /><button className="adm-btn danger sm" type="submit">Reject</button></form></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="dim">No pending referrals.</p>}
      </section>

      <section className="adm-card scroll">
        <h2>Recent ledger entries</h2>
        <table>
          <thead><tr><th>When</th><th>Player</th><th>Balance</th><th>Amount</th><th>Reason</th></tr></thead>
          <tbody>{(ledger ?? []).map((l) => (
            <tr key={l.id}><td>{new Date(l.created_at).toLocaleString()}</td><td>{short(l.user_id)}</td><td>{l.balance_type}</td><td>{Number(l.amount).toLocaleString()}</td><td>{l.reason}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}
