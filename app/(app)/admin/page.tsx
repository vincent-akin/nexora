import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin';
import { markReviewed, rejectReferral } from './actions';

export const dynamic = 'force-dynamic';

export default async function Admin() {
  await requireAdmin();
  const admin = createAdminClient();

  const [{ data: flags }, { data: pending }, { data: ledger }] = await Promise.all([
    admin.from('risk_flags').select('id,user_id,kind,detail,created_at').eq('reviewed', false).order('created_at', { ascending: false }).limit(50),
    admin.from('referrals').select('id,referrer_id,referred_id,created_at').eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
    admin.from('points_ledger').select('id,user_id,balance_type,amount,reason,created_at').order('created_at', { ascending: false }).limit(50),
  ]);

  return (
    <main className="page">
      <div>
        <h1>Admin</h1>
        <p className="dim">Every action here is written to the audit log.</p>
      </div>

      <section className="card">
        <h2>Flagged and rejected runs</h2>
        {flags && flags.length ? (
          <table>
            <thead><tr><th>When</th><th>Player</th><th>Kind</th><th>Detail</th><th /></tr></thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id}>
                  <td>{new Date(f.created_at).toLocaleString()}</td>
                  <td>{String(f.user_id).slice(0, 8)}</td>
                  <td>{f.kind}</td>
                  <td>{JSON.stringify(f.detail)}</td>
                  <td><form action={markReviewed}><input type="hidden" name="id" value={f.id} /><button className="btn" type="submit">Mark reviewed</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="dim">Nothing waiting for review.</p>}
      </section>

      <section className="card">
        <h2>Pending referrals</h2>
        {pending && pending.length ? (
          <table>
            <thead><tr><th>When</th><th>Referrer</th><th>Referred</th><th /></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{String(r.referrer_id).slice(0, 8)}</td>
                  <td>{String(r.referred_id).slice(0, 8)}</td>
                  <td><form action={rejectReferral}><input type="hidden" name="id" value={r.id} /><button className="btn" type="submit">Reject</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="dim">No pending referrals.</p>}
      </section>

      <section className="card">
        <h2>Recent ledger entries</h2>
        <table>
          <thead><tr><th>When</th><th>Player</th><th>Balance</th><th>Amount</th><th>Reason</th></tr></thead>
          <tbody>
            {(ledger ?? []).map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.created_at).toLocaleString()}</td>
                <td>{String(l.user_id).slice(0, 8)}</td>
                <td>{l.balance_type}</td>
                <td>{Number(l.amount).toLocaleString()}</td>
                <td>{l.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
