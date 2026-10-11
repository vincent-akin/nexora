import { createClient } from '@/lib/supabase/server';
import { POINTS_DISCLAIMER } from '@/lib/copy';

export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = { xp: 'XP', coins: 'Coins', airdrop_points: 'Airdrop Points' };

export default async function Rewards() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('points_ledger')
    .select('id,balance_type,amount,reason,created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <main className="page">
      <div>
        <h1>Rewards</h1>
        <p className="dim">Every XP, Coin and Airdrop Point you earn is recorded here with its reason.</p>
      </div>
      <p className="notice">{POINTS_DISCLAIMER}</p>
      <section className="card">
        {rows && rows.length ? (
          <table>
            <thead><tr><th>When</th><th>What</th><th>Amount</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.reason}</td>
                  <td>+{Number(r.amount).toLocaleString()} {LABEL[r.balance_type]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">Nothing earned yet. Play a run or claim your daily reward.</p>
        )}
      </section>
    </main>
  );
}
