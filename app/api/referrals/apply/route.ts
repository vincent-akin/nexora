import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { applyPendingReferral } from '@/lib/referrals';

/** Records the referral code stored at sign-up. Called once a session exists. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  return NextResponse.json(await applyPendingReferral(user));
}
