import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BEAT_MAX_LEVEL, beatCleared, generateChart, rewardFor, validateSubmission, type Tap } from '@/lib/beat-lanes/core';
import { loadSession, sessionProblem } from '@/lib/settle';
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

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.taps)) return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const admin = createAdminClient();

  // The session, seed, level and boosts come from our own record, never from the client.
  const look = await loadSession(admin, id, user.id, 'beat_lanes');
  if (!look.ok) return sessionProblem(look);
  const session = look.session;

  const spec = { level: session.level, boosts: session.boosts as BoostKind[] };
  const chart = generateChart(Number(session.seed), spec);
  const validation = validateSubmission({
    chart,
    taps: body.taps as Tap[],
    spec,
    offsetMs: Number(body.offsetMs ?? 0),
    serverElapsedMs: Date.now() - new Date(session.started_at).getTime(),
  });

  if (validation.verdict === 'rejected' || !validation.result) {
    await admin.rpc('reject_game_run', { p_session: id, p_user: user.id, p_reasons: validation.reasons });
    return NextResponse.json({ verdict: 'rejected', reasons: validation.reasons }, { status: 422 });
  }

  const result = validation.result;
  const reward = rewardFor(result, spec, validation.verdict);
  const { data: settled, error } = await admin.rpc('settle_game_run', {
    p_session: id,
    p_user: user.id,
    p_score: result.score,
    p_accuracy: Number(result.accuracy.toFixed(4)),
    p_max_combo: result.maxCombo,
    p_verdict: validation.verdict,
    p_flags: validation.flags,
    p_xp: reward.xp,
    p_coins: reward.coins,
    p_points: reward.airdropPoints,
  });
  if (error) {
    // session_not_open means a concurrent submit already settled this run.
    const status = error.message.includes('session_not_open') ? 409 : 500;
    return NextResponse.json({ error: 'settle_failed' }, { status });
  }

  // May approve a pending referral for this player (idempotent, errors are not fatal).
  if (!session.practice) await admin.rpc('qualify_referral', { p_referred: user.id });

  // Finishing the song at 60% or better, in a run nobody has flagged, opens the next level.
  const cleared = beatCleared(result);
  const unlocked = cleared && validation.verdict === 'accepted' && !session.practice ? await unlockLevel(admin, user.id, 'beat_lanes', Math.min(BEAT_MAX_LEVEL, session.level + 1)) : null;

  return NextResponse.json({
    verdict: validation.verdict,
    flags: validation.flags,
    score: result.score,
    accuracy: result.accuracy,
    maxCombo: result.maxCombo,
    perfects: result.perfects,
    goods: result.goods,
    earlies: result.earlies,
    misses: result.misses,
    strays: result.strays,
    completed: result.completed,
    level: session.level,
    boosts: spec.boosts,
    practice: session.practice,
    cleared,
    unlocked,
    granted: settled?.grant?.granted ?? {},
  });
}
