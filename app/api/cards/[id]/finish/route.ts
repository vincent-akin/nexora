import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CARD_CONFIG, type Flip } from '@/lib/card-clash/core';
import { loadOpenSession, serverElapsedMs, settleCardRun } from '@/lib/card-clash/server';

const CLOCK_TOLERANCE_MS = 1500;

/** Closes a run when the clock has run out. Refused while there is still time on the server's clock. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const admin = createAdminClient();
  const session = await loadOpenSession(admin, id, user.id);
  if (!session) return NextResponse.json({ error: 'session_closed' }, { status: 409 });

  if (serverElapsedMs(session) < CARD_CONFIG[session.difficulty].timeLimitMs - CLOCK_TOLERANCE_MS) {
    return NextResponse.json({ error: 'not_finished' }, { status: 409 });
  }
  const final = await settleCardRun(admin, session, (session.state?.flips ?? []) as Flip[]);
  if (!final) return NextResponse.json({ error: 'settle_failed' }, { status: 409 });
  return NextResponse.json(final);
}
