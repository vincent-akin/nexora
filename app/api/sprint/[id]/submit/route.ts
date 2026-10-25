import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sprintQuality, sprintRewardFor, sprintStars, sprintUnlocks, validateSprint, type Key } from '@/lib/type-sprint/core';
import { loadSession, sessionProblem, settleRun } from '@/lib/settle';
import { unlockLevel } from '@/lib/run-start';
import type { BoostKind } from '@/lib/boosts';

const MAX_BODY_BYTES = 120_000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.keys)) return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const admin = createAdminClient();
  const look = await loadSession(admin, id, user.id, 'type_sprint');
  if (!look.ok) return sessionProblem(look);
  const session = look.session;

  // Level and boosts come from our own record of the session, never from the browser.
  const spec = { level: session.level, boosts: session.boosts as BoostKind[] };
  const v = validateSprint(Number(session.seed), spec, body.keys as Key[], Date.now() - new Date(session.started_at).getTime());

  if (v.verdict === 'rejected' || !v.result) {
    await admin.rpc('reject_game_run', { p_session: id, p_user: user.id, p_reasons: v.reasons });
    return NextResponse.json({ verdict: 'rejected', reasons: v.reasons }, { status: 422 });
  }
  const r = v.result;
  const granted = await settleRun(admin, {
    sessionId: id, userId: user.id, score: r.score, accuracy: r.accuracy, maxCombo: r.bestStreak,
    verdict: v.verdict, flags: v.flags, reward: sprintRewardFor(r, spec, v.verdict), practice: session.practice,
  });
  if (granted === null) return NextResponse.json({ error: 'settle_failed' }, { status: 409 });

  // Flagged runs do not move the ladder: a macro must not be able to climb it.
  const next = v.verdict === 'accepted' && !session.practice ? sprintUnlocks(r) : null;
  const unlocked = next ? await unlockLevel(admin, user.id, 'type_sprint', next) : null;
  return NextResponse.json({
    verdict: v.verdict, flags: v.flags, score: r.score, wpm: Math.round(r.wpm), accuracy: r.accuracy, correctChars: r.correct,
    errors: r.errors, wordsDone: r.wordsDone, missed: r.missed, bestStreak: r.bestStreak, stagesCleared: r.stagesCleared,
    startLevel: r.startLevel, reachedLevel: r.reachedLevel, endReason: r.endReason, quality: sprintQuality(r), stars: sprintStars(r),
    boosts: spec.boosts, practice: session.practice, unlocked, granted,
  });
}
