import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Uses one consumable (the stamina refill). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.itemId !== 'string') return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  const { data, error } = await createAdminClient().rpc('use_item', { p_user: user.id, p_item: body.itemId });
  if (error) return NextResponse.json({ error: 'use_failed' }, { status: error.message.includes('unknown_item') ? 404 : 500 });
  return NextResponse.json(data, { status: data?.error ? 400 : 200 });
}
