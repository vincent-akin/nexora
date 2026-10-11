import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.missionId !== 'string') return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const { data, error } = await createAdminClient().rpc('claim_mission', { p_user: user.id, p_mission: body.missionId });
  if (error) {
    const status = error.message.includes('unknown_mission') ? 404 : 500;
    return NextResponse.json({ error: 'claim_failed' }, { status });
  }
  return NextResponse.json(data);
}
