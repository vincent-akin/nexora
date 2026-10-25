import 'server-only';
import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminSession } from '@/lib/admin';
import { levelForXp, type LevelRow } from '@/lib/beat-lanes/progression';
import { GAMES, clampLevel, tierFor, type GameKey, type Tier } from '@/lib/levels';
import { sanitizeBoosts, type BoostKind } from '@/lib/boosts';

export interface StartedRun {
  user: { id: string };
  sessionId: string;
  seed: number;
  level: number;
  tier: Tier;
  boosts: BoostKind[];
  stamina: number;
  expiresAt: string;
  /** An admin testing the game: every level and boost, no stamina, nothing earned. */
  practice: boolean;
}

/**
 * Everything the four start routes have in common: sign-in, the account-level lock, the level
 * ladder, boosts, stamina. Returns the run, or a ready-made error response.
 * The seed is generated here and handed back so the route decides what the browser may see.
 */
export async function startRun(request: Request, game: GameKey, contentVersion: string): Promise<StartedRun | NextResponse> {
  const info = GAMES[game];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const level = clampLevel(Number(body?.level ?? 1), info.maxLevel);
  const boosts = sanitizeBoosts(game, body?.boosts);

  const [{ data: bal }, { data: levels }] = await Promise.all([
    supabase.from('player_balances').select('xp').eq('user_id', user.id).single(),
    supabase.from('level_config').select('level,name,xp_required'),
  ]);
  const account = levelForXp(Number(bal?.xp ?? 0), (levels ?? [{ level: 1, name: 'The Rookie', xp_required: 0 }]) as LevelRow[]);
  const practice = await isAdminSession(supabase, user.id);
  if (!practice && account.level < info.minAccountLevel) {
    return NextResponse.json({ error: 'locked', requiredLevel: info.minAccountLevel }, { status: 403 });
  }

  const tier = tierFor(level, info.maxLevel);
  const seed = randomInt(0, 2 ** 32);
  const { data, error } = await createAdminClient().rpc('begin_level_run', {
    p_user: user.id, p_game: game, p_difficulty: tier, p_level: level, p_seed: seed,
    p_content_version: contentVersion, p_boosts: boosts, p_max_level: info.maxLevel, p_practice: practice,
  });

  if (error) {
    const m = error.message ?? '';
    for (const code of ['boost_not_owned', 'unknown_boost', 'duplicate_boost']) {
      if (m.includes(code)) return NextResponse.json({ error: code }, { status: code === 'boost_not_owned' ? 409 : 400 });
    }
    console.error('[start_run] begin_level_run failed:', m, '- are migrations 0006 and 0007 applied?');
    return NextResponse.json({ error: 'start_failed', hint: 'Apply supabase/migrations/0006_levels_boosts_admin.sql and 0007_admin_practice_rules.sql.' }, { status: 500 });
  }
  if (data?.error === 'insufficient_stamina') {
    return NextResponse.json({ error: 'insufficient_stamina', secondsUntilNext: data.seconds_until_next, stamina: data.stamina }, { status: 429 });
  }
  if (data?.error === 'level_locked') return NextResponse.json({ error: 'level_locked', unlocked: data.unlocked }, { status: 403 });
  if (data?.error === 'account_suspended') return NextResponse.json({ error: 'account_suspended' }, { status: 403 });
  if (data?.error === 'not_admin') return NextResponse.json({ error: 'not_admin' }, { status: 403 });
  if (data?.error) return NextResponse.json({ error: data.error }, { status: 400 });

  return {
    user, sessionId: data.session_id, seed, level, tier, boosts: (data.boosts ?? []) as BoostKind[],
    stamina: data.stamina, expiresAt: data.expires_at, practice,
  };
}

/** Raises the player's unlocked level after a validated run. Returns the new highest unlocked level. */
export async function unlockLevel(admin: SupabaseClient, userId: string, game: GameKey, reached: number): Promise<number | null> {
  const { data, error } = await admin.rpc('unlock_game_level', { p_user: userId, p_game: game, p_level: reached, p_max: GAMES[game].maxLevel });
  if (error) { console.error('[unlock_level]', error.message); return null; }
  return Number(data);
}
