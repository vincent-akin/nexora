import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { applyPendingReferral } from '@/lib/referrals';

/** Email-confirmation landing route: exchanges the code for a session, then records any referral. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) await applyPendingReferral(user);
      return NextResponse.redirect(`${origin}/`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=confirmation_failed`);
}
