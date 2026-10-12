import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateChart, rewardFor, validateSubmission, type Difficulty, type Tap } from '@/lib/beat-lanes/core';

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

  // The session, seed and difficulty come from our own record, never from the client.
  const { data: session } = await admin
    .from('game_sessions')
    .select('id,user_id,difficulty,seed,status,started_at,expires_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (session.status !== 'started' || new Date(session.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'session_closed' }, { status: 409 });
  }

  const difficulty = session.difficulty as Difficulty;
  const chart = generateChart(Number(session.seed), difficulty);
  const validation = validateSubmission({
    chart,
    taps: body.taps as Tap[],
    difficulty,
    offsetMs: Number(body.offsetMs ?? 0),
    serverElapsedMs: Date.now() - new Date(session.started_at).getTime(),
  });

  if (validation.verdict === 'rejected' || !validation.result) {
    await admin.rpc('reject_game_run', { p_session: id, p_user: user.id, p_reasons: validation.reasons });
    return NextResponse.json({ verdict: 'rejected', reasons: validation.reasons }, { status: 422 });
  }

  const result = validation.result;
  const reward = rewardFor(result, difficulty, validation.verdict);
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
  await admin.rpc('qualify_referral', { p_referred: user.id });

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
    granted: settled?.grant?.granted ?? {},
  });
}
