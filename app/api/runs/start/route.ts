import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DIFFICULTY, type Difficulty } from '@/lib/beat-lanes/core';
import { DIFFICULTY_MIN_LEVEL, levelForXp } from '@/lib/beat-lanes/progression';

const CONTENT_VERSION = 'beat-lanes-v1';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const difficulty = body?.difficulty as Difficulty;
  if (!difficulty || !(difficulty in DIFFICULTY)) {
    return NextResponse.json({ error: 'bad_difficulty' }, { status: 400 });
  }

  // Unlock check uses the player's own rows (RLS) and the shared level table.
  const [{ data: bal }, { data: levels }] = await Promise.all([
    supabase.from('player_balances').select('xp').eq('user_id', user.id).single(),
    supabase.from('level_config').select('level,name,xp_required'),
  ]);
  const level = levelForXp(Number(bal?.xp ?? 0), levels ?? [{ level: 1, name: 'The Rookie', xp_required: 0 }]);
  if (level.level < DIFFICULTY_MIN_LEVEL[difficulty]) {
    return NextResponse.json({ error: 'locked', requiredLevel: DIFFICULTY_MIN_LEVEL[difficulty] }, { status: 403 });
  }

  const seed = randomInt(0, 2 ** 32);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('start_game_run', {
    p_user: user.id,
    p_game: 'beat_lanes',
    p_difficulty: difficulty,
    p_seed: seed,
    p_content_version: CONTENT_VERSION,
  });
  if (error) return NextResponse.json({ error: 'start_failed' }, { status: 500 });
  if (data?.error === 'insufficient_stamina') {
    return NextResponse.json(
      { error: 'insufficient_stamina', secondsUntilNext: data.seconds_until_next, stamina: data.stamina },
      { status: 429 },
    );
  }
  return NextResponse.json({
    sessionId: data.session_id,
    seed,
    difficulty,
    expiresAt: data.expires_at,
    stamina: data.stamina,
  });
}
