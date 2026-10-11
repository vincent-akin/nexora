import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Server-side admin gate, used by every admin page and action. Requires a row
 * in admin_users and, unless ADMIN_REQUIRE_MFA=false, a session at assurance
 * level aal2 (a second factor completed).
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await createAdminClient().from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!row) redirect('/');

  if (process.env.ADMIN_REQUIRE_MFA !== 'false') {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== 'aal2') redirect('/?mfa=required');
  }
  return user;
}
