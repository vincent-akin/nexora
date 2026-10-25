import { createAdminClient } from '@/lib/supabase/admin';

export default async function Audit() {
  const { data } = await createAdminClient().from('admin_audit_logs').select('id,actor_id,action,target,detail,created_at').order('created_at', { ascending: false }).limit(100);
  return (
    <>
      <div><h1>Audit log</h1><p className="dim">Every admin action, newest first. Nothing here can be edited.</p></div>
      <section className="adm-card scroll">
        <table>
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>{(data ?? []).map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.created_at).toLocaleString()}</td><td>{String(a.actor_id ?? '').slice(0, 8)}</td>
              <td><span className="adm-pill amber">{a.action}</span></td><td>{a.target}</td><td><code>{JSON.stringify(a.detail)}</code></td>
            </tr>
          ))}</tbody>
        </table>
        {!(data ?? []).length ? <p className="dim">Nothing yet.</p> : null}
      </section>
    </>
  );
}
