import { createAdminClient } from '@/lib/supabase/admin';
import AdminMsg from '@/components/AdminMsg';
import { grantPlayer, setPlayerStatus } from '../actions';

export default async function Players({ searchParams }: { searchParams: Promise<{ q?: string; msg?: string; bad?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 40).replace(/[%_,()]/g, '');
  const db = createAdminClient();
  let query = db.from('profiles').select('id,display_name,account_status,created_at,referral_code').order('created_at', { ascending: false }).limit(25);
  if (q) query = query.ilike('display_name', `%${q}%`);
  const { data: players } = await query;
  const ids = (players ?? []).map((p) => p.id);
  const [{ data: bals }, { data: runs }] = await Promise.all([
    ids.length ? db.from('player_balances').select('user_id,xp,coins,airdrop_points').in('user_id', ids) : Promise.resolve({ data: [] as { user_id: string; xp: number; coins: number; airdrop_points: number }[] }),
    ids.length ? db.from('game_scores').select('user_id').in('user_id', ids) : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]);
  const bal = new Map((bals ?? []).map((b) => [b.user_id, b]));
  const runCount = new Map<string, number>();
  for (const r of runs ?? []) runCount.set(r.user_id, (runCount.get(r.user_id) ?? 0) + 1);

  return (
    <>
      <div><h1>Players</h1><p className="dim">Find a player, give them XP or Coins, or suspend an account. Suspended players cannot start runs and leave the leaderboard.</p></div>
      <AdminMsg msg={sp.msg} bad={sp.bad} />

      <form className="adm-row" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Search by display name" aria-label="Search players" style={{ maxWidth: 320 }} />
        <button className="adm-btn primary" type="submit">Search</button>
        {q ? <a className="adm-btn" href="/admin/players">Clear</a> : null}
      </form>

      <section className="adm-card scroll">
        <table>
          <thead><tr><th>Player</th><th>Joined</th><th>XP</th><th>Coins</th><th>Points</th><th>Runs</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{(players ?? []).map((p) => {
            const b = bal.get(p.id);
            const suspended = p.account_status !== 'active';
            return (
              <tr key={p.id}>
                <td><b>{p.display_name}</b><br /><span className="dim">{p.id.slice(0, 8)}</span></td>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
                <td>{Number(b?.xp ?? 0).toLocaleString()}</td><td>{Number(b?.coins ?? 0).toLocaleString()}</td><td>{Number(b?.airdrop_points ?? 0).toLocaleString()}</td>
                <td>{runCount.get(p.id) ?? 0}</td>
                <td>{suspended ? <span className="adm-pill bad">Suspended</span> : <span className="adm-pill good">Active</span>}</td>
                <td>
                  <details>
                    <summary>Manage</summary>
                    <form action={grantPlayer} className="adm-form" style={{ margin: '10px 0', minWidth: 260 }}>
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="q" value={q} />
                      <label>XP<input type="number" name="xp" min={0} max={100000} defaultValue={0} /></label>
                      <label>Coins<input type="number" name="coins" min={0} max={100000} defaultValue={0} /></label>
                      <label className="wide">Reason (audit log)<input type="text" name="reason" maxLength={120} required /></label>
                      <div className="wide"><button className="adm-btn primary sm" type="submit">Give</button></div>
                    </form>
                    <form action={setPlayerStatus} className="adm-row">
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="q" value={q} />
                      <input type="hidden" name="status" value={suspended ? 'active' : 'suspended'} />
                      <input type="text" name="reason" placeholder="Reason" aria-label="Reason" style={{ width: 150 }} />
                      <button className={`adm-btn sm${suspended ? '' : ' danger'}`} type="submit">{suspended ? 'Reactivate' : 'Suspend'}</button>
                    </form>
                  </details>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
        {!(players ?? []).length ? <p className="dim">No players found.</p> : null}
      </section>
      <p className="adm-note">Airdrop Points cannot be granted here. They are earned in play, so the totals stay honest.</p>
    </>
  );
}
