'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/admin';

/** Marks a risk flag as reviewed and writes an audit record. */
export async function markReviewed(formData: FormData) {
  const actor = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const admin = createAdminClient();
  await admin.from('risk_flags').update({ reviewed: true }).eq('id', id);
  await admin.from('admin_audit_logs').insert({ actor_id: actor.id, action: 'risk_flag_reviewed', target: id });
  revalidatePath('/admin');
}

/** Rejects a pending referral so it can never be approved. */
export async function rejectReferral(formData: FormData) {
  const actor = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const admin = createAdminClient();
  await admin.from('referrals').update({ status: 'rejected' }).eq('id', id).eq('status', 'pending');
  await admin.from('admin_audit_logs').insert({ actor_id: actor.id, action: 'referral_rejected', target: id });
  revalidatePath('/admin');
}
