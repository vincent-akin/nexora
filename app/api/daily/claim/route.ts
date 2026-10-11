import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const { data, error } = await createAdminClient().rpc('claim_daily', { p_user: user.id });
  if (error) return NextResponse.json({ error: 'claim_failed' }, { status: 500 });
  return NextResponse.json(data);
}
