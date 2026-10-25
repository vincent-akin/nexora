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
  if (!row) redirect('/dashboard');

  if (process.env.ADMIN_REQUIRE_MFA !== 'false') {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (data?.currentLevel !== 'aal2') redirect('/dashboard?mfa=required');
  }
  return user;
}

/**
 * True when the signed-in player is an admin (and, unless ADMIN_REQUIRE_MFA=false, has completed a
 * second factor). Used to switch on practice mode in the games. It never redirects.
 */
export async function isAdminSession(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<boolean> {
  const { data: row } = await createAdminClient().from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
  if (!row) return false;
  if (process.env.ADMIN_REQUIRE_MFA === 'false') return true;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal2';
}

/** Writes one audit record. Every admin action calls this, so nothing an admin does is unrecorded. */
export async function audit(actor: string, action: string, target: string | null, detail: Record<string, unknown> = {}) {
  await createAdminClient().from('admin_audit_logs').insert({ actor_id: actor, action, target, detail });
}
