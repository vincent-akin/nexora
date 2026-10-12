import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyFlip, type Flip } from '@/lib/card-clash/core';
import { deckFor, loadOpenSession, serverElapsedMs, settleCardRun } from '@/lib/card-clash/server';

/**
 * Reveals one card. This is the ONLY way a face ever reaches the player, and the
 * timestamp comes from the server clock, so the client can neither peek nor lie about timing.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.index !== 'number') return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const admin = createAdminClient();
  const session = await loadOpenSession(admin, id, user.id);
  if (!session) return NextResponse.json({ error: 'session_closed' }, { status: 409 });

  const deck = deckFor(session);
  const flips = (session.state?.flips ?? []) as Flip[];
  const out = applyFlip(deck, flips, body.index, serverElapsedMs(session), session.difficulty);

  if (!out.ok) {
    if (out.reason === 'time_up') {
      const final = await settleCardRun(admin, session, flips);
      return NextResponse.json({ error: 'time_up', final }, { status: 410 });
    }
    return NextResponse.json({ error: out.reason }, { status: out.reason === 'too_fast' ? 429 : 400 });
  }

  const { data: saved } = await admin.rpc('save_game_state', {
    p_session: id,
    p_user: user.id,
    p_expected: session.state_version,
    p_state: { flips: out.flips },
  });
  if (!saved) return NextResponse.json({ error: 'conflict' }, { status: 409 });

  const s = out.state;
  const final = s.done ? await settleCardRun(admin, { ...session, state: { flips: out.flips } }, out.flips) : null;
  return NextResponse.json({
    face: out.face,
    result: out.result,
    done: s.done,
    score: s.score,
    streak: s.streak,
    matched: s.matchedPairs,
    mismatches: s.mismatches,
    final,
  });
}
