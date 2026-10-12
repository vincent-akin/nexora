import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CARD_CONFIG, CARD_MIN_LEVEL, type CardDifficulty } from '@/lib/card-clash/core';
import { levelForXp } from '@/lib/beat-lanes/progression';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const difficulty = body?.difficulty as CardDifficulty;
  if (!difficulty || !(difficulty in CARD_CONFIG)) return NextResponse.json({ error: 'bad_difficulty' }, { status: 400 });

  const [{ data: bal }, { data: levels }] = await Promise.all([
    supabase.from('player_balances').select('xp').eq('user_id', user.id).single(),
    supabase.from('level_config').select('level,name,xp_required'),
  ]);
  const level = levelForXp(Number(bal?.xp ?? 0), levels ?? [{ level: 1, name: 'The Rookie', xp_required: 0 }]);
  if (level.level < CARD_MIN_LEVEL[difficulty]) {
    return NextResponse.json({ error: 'locked', requiredLevel: CARD_MIN_LEVEL[difficulty] }, { status: 403 });
  }

  // The seed is stored on the server and never returned: it is the deck.
  const { data, error } = await createAdminClient().rpc('start_game_run', {
    p_user: user.id,
    p_game: 'card_clash',
    p_difficulty: difficulty,
    p_seed: randomInt(0, 2 ** 32),
    p_content_version: 'card-clash-v1',
  });
  if (error) return NextResponse.json({ error: 'start_failed' }, { status: 500 });
  if (data?.error === 'insufficient_stamina') {
    return NextResponse.json({ error: 'insufficient_stamina', secondsUntilNext: data.seconds_until_next, stamina: data.stamina }, { status: 429 });
  }
  const cfg = CARD_CONFIG[difficulty];
  return NextResponse.json({
    sessionId: data.session_id,
    difficulty,
    cols: cfg.cols,
    rows: cfg.rows,
    pairs: cfg.pairs,
    timeLimitMs: cfg.timeLimitMs,
    expiresAt: data.expires_at,
    stamina: data.stamina,
  });
}
