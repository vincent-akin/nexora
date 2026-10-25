import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyAnswer, detectiveCleared, detectiveRewardFor, validateDetective, DETECTIVE_MAX_LEVEL, type AnswerRec } from '@/lib/market-detective/core';
import { loadSession, saveState, sessionProblem, settleRun } from '@/lib/settle';
import { unlockLevel } from '@/lib/run-start';
import type { BoostKind } from '@/lib/boosts';

interface State { answers?: AnswerRec[]; current?: { n: number; startedAtMs: number } | null }

/** Checks an answer. The time taken is measured by the server, and the right answer is revealed only now. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.choice !== 'number') return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const admin = createAdminClient();
  const look = await loadSession(admin, id, user.id, 'market_detective');
  if (!look.ok) return sessionProblem(look);
  const session = look.session;

  const spec = { level: session.level, boosts: session.boosts as BoostKind[] };
  const state = (session.state ?? {}) as State;
  if (!state.current) return NextResponse.json({ error: 'no_round_open' }, { status: 409 });

  const ms = Date.now() - new Date(session.started_at).getTime() - state.current.startedAtMs;
  const out = applyAnswer(Number(session.seed), spec, state.answers ?? [], state.current.n, body.choice, ms);
  if (!out.ok) return NextResponse.json({ error: out.reason }, { status: 400 });

  const saved = await saveState(admin, id, user.id, session.state_version, { answers: out.answers, current: null });
  if (saved === 'error') return NextResponse.json({ error: 'schema_out_of_date', hint: 'Apply the pending Supabase migrations (0003 and 0006).' }, { status: 500 });
  if (saved === 'conflict') return NextResponse.json({ error: 'conflict' }, { status: 409 });

  const s = out.state;
  let final: Record<string, unknown> | null = null;
  if (s.done) {
    const v = validateDetective(Number(session.seed), spec, out.answers);
    if (v.verdict === 'rejected' || !v.final) {
      await admin.rpc('reject_game_run', { p_session: id, p_user: user.id, p_reasons: v.reasons });
      final = { verdict: 'rejected', reasons: v.reasons };
    } else {
      const granted = await settleRun(admin, {
        sessionId: id, userId: user.id, score: v.final.score, accuracy: v.final.quality, maxCombo: v.final.bestStreak,
        verdict: v.verdict, flags: v.flags, reward: detectiveRewardFor(v.final, spec, v.verdict), practice: session.practice,
      });
      // A level is cleared at 60% correct. Clearing it, and keeping the run clean, unlocks the next.
      const cleared = detectiveCleared(v.final);
      const unlocked = cleared && v.verdict === 'accepted' && !session.practice ? await unlockLevel(admin, user.id, 'market_detective', Math.min(DETECTIVE_MAX_LEVEL, session.level + 1)) : null;
      final = { verdict: v.verdict, flags: v.flags, ...v.final, granted: granted ?? {}, level: session.level, boosts: spec.boosts, practice: session.practice, cleared, unlocked };
    }
  }
  return NextResponse.json({ correct: out.correct, answerIndex: out.answerIndex, metrics: out.metrics, score: s.score, correctCount: s.correct, streak: s.streak, done: s.done, final });
}
