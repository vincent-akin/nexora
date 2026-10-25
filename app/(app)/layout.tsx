import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import LineIcon from '@/components/LineIcon';
import Logo from '@/components/Logo';
import NavLink from '@/components/NavLink';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: adminRow } = await createAdminClient().from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();

  async function signOut() {
    'use server';
    const s = await createClient();
    await s.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/dashboard" className="brand"><Logo size={30} /> Nexora</Link>
        <nav className="nav" aria-label="Main">
          <NavLink href="/dashboard"><LineIcon name="home" /> Dashboard</NavLink>
          <NavLink href="/arena"><LineIcon name="gamepad" /> Arena</NavLink>
          <NavLink href="/missions"><LineIcon name="target" /> Tasks</NavLink>
          <NavLink href="/leaderboard"><LineIcon name="trophy" /> Leaderboard</NavLink>
          <NavLink href="/referrals"><LineIcon name="users" /> Referrals</NavLink>
          <NavLink href="/rewards"><LineIcon name="receipt" /> Rewards</NavLink>
          <NavLink href="/shop"><LineIcon name="bag" /> Shop</NavLink>
          {adminRow ? <NavLink href="/admin"><LineIcon name="shield" /> Admin console</NavLink> : null}
          <form action={signOut}>
            <button className="btn ghost" type="submit" style={{ padding: '8px 12px' }}><LineIcon name="logout" /> Sign out</button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
