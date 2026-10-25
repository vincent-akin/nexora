import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Buys an item with Coins. The price comes from the database; the client only names the item. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.itemId !== 'string' || typeof body?.requestId !== 'string' || !UUID.test(body.requestId)) {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }
  const { data, error } = await createAdminClient().rpc('purchase_item', { p_user: user.id, p_item: body.itemId, p_request: body.requestId });
  if (error) return NextResponse.json({ error: error.message.includes('unknown_item') ? 'unknown_item' : 'purchase_failed' }, { status: error.message.includes('unknown_item') ? 404 : 500 });
  return NextResponse.json(data, { status: data?.error ? 400 : 200 });
}
