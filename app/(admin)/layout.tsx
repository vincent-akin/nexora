import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin';
import AdminNav from '@/components/AdminNav';
import '@/styles/admin.css';

export const dynamic = 'force-dynamic';

/**
 * The admin console has its own shell, separate from the player app: a sidebar, a different colour
 * and no game navigation. Every page under it is gated here, and every action re-checks on the server.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const db = createAdminClient();
  const [tweets, flags, refs] = await Promise.all([
    db.from('social_submissions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('risk_flags').select('id', { count: 'exact', head: true }).eq('reviewed', false),
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  const waiting = (tweets.count ?? 0) + (flags.count ?? 0) + (refs.count ?? 0);

  return (
    <div className="adm">
      <aside className="adm-side">
        <Link href="/admin" className="adm-brand"><span aria-hidden="true">N</span> Nexora <small>Admin</small></Link>
        <AdminNav badges={{ '/admin/reviews': waiting }} />
        <div className="adm-foot">
          <Link href="/dashboard" className="adm-link">Open the player app</Link>
          <span className="adm-who" title={user.email ?? ''}>{user.email ?? 'admin'}</span>
        </div>
      </aside>
      <main className="adm-main">{children}</main>
    </div>
  );
}
