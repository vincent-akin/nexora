import 'server-only';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * If the account signed up through a referral link (the code is stored in the
 * user metadata at sign-up), record the pending referral. Safe to call many
 * times: the database allows one referral per referred account.
 */
export async function applyPendingReferral(user: User) {
  const code = user.user_metadata?.referral_code;
  if (typeof code !== 'string' || !code.trim()) return { ok: false, reason: 'no_code' };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('apply_referral', { p_referred: user.id, p_code: code });
  if (error) return { ok: false, reason: error.message };
  return data as { ok: boolean; reason?: string };
}
