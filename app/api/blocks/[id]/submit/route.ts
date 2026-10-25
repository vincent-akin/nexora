import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { blockRewardFor, blockStars, blockUnlocks, validateBlocks, type Action } from '@/lib/block-drop/core';
import { loadSession, sessionProblem, settleRun } from '@/lib/settle';
import { unlockLevel } from '@/lib/run-start';
import type { BoostKind } from '@/lib/boosts';

const MAX_BODY_BYTES = 200_000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.actions)) return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const admin = createAdminClient();
  const look = await loadSession(admin, id, user.id, 'block_drop');
  if (!look.ok) return sessionProblem(look);
  const session = look.session;

  // Level and boosts come from our own record of the session, never from the browser.
  const spec = { level: session.level, boosts: session.boosts as BoostKind[] };
  const v = validateBlocks(Number(session.seed), spec, body.actions as Action[], Date.now() - new Date(session.started_at).getTime());

  if (v.verdict === 'rejected' || !v.result) {
    await admin.rpc('reject_game_run', { p_session: id, p_user: user.id, p_reasons: v.reasons });
    return NextResponse.json({ verdict: 'rejected', reasons: v.reasons }, { status: 422 });
  }
  const r = v.result;
  const granted = await settleRun(admin, {
    sessionId: id, userId: user.id, score: r.score, accuracy: Math.min(1, r.lines / 20), maxCombo: r.bestCombo,
    verdict: v.verdict, flags: v.flags, reward: blockRewardFor(r, spec, v.verdict), practice: session.practice,
  });
  if (granted === null) return NextResponse.json({ error: 'settle_failed' }, { status: 409 });

  // Flagged runs do not move the ladder: a bot must not be able to climb it.
  const next = v.verdict === 'accepted' && !session.practice ? blockUnlocks(r) : null;
  const unlocked = next ? await unlockLevel(admin, user.id, 'block_drop', next) : null;
  return NextResponse.json({
    verdict: v.verdict, flags: v.flags, score: r.score, lines: r.lines, pieces: r.pieces, bestCombo: r.bestCombo,
    startLevel: r.startLevel, reachedLevel: r.reachedLevel, endReason: r.endReason, stars: blockStars(r), boosts: spec.boosts, practice: session.practice, unlocked, granted,
  });
}
