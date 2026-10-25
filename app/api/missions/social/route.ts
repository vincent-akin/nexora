import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Submits the link to a tweet for manual review. Nothing is verified against X
 * automatically: a reviewer approves the link, and only then is the reward paid.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.missionId !== 'string' || typeof body?.url !== 'string' || body.url.length > 300) {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }

  const { data, error } = await createAdminClient().rpc('submit_social_task', {
    p_user: user.id,
    p_mission: body.missionId,
    p_url: body.url,
  });
  if (error) {
    const status = error.message.includes('unknown_mission') ? 404 : 500;
    return NextResponse.json({ error: 'submit_failed' }, { status });
  }
  if (data?.error) return NextResponse.json(data, { status: 400 });
  return NextResponse.json(data);
}
