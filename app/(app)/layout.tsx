import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Icon from '@/components/Icon';
import Mascot from '@/components/Mascot';

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
        <Link href="/" className="wordmark"><Mascot /> Nexora</Link>
        <nav className="nav" aria-label="Main">
          <Link href="/"><Icon name="house" size={20} /> Home</Link>
          <Link href="/arena"><Icon name="play" size={20} /> Arena</Link>
          <Link href="/missions"><Icon name="target" size={20} /> Missions</Link>
          <Link href="/leaderboard"><Icon name="trophy" size={20} /> Ranks</Link>
          <Link href="/referrals"><Icon name="users" size={20} /> Friends</Link>
          <Link href="/rewards"><Icon name="gem" size={20} /> Rewards</Link>
          {adminRow ? <Link href="/admin"><Icon name="shield" size={20} /> Admin</Link> : null}
          <form action={signOut} style={{ display: 'inline' }}>
            <button className="btn" type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  );
}
