import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildRound, detectiveConfig, publicRound, type AnswerRec } from '@/lib/market-detective/core';
import { loadSession, saveState, sessionProblem } from '@/lib/settle';
import type { BoostKind } from '@/lib/boosts';

interface State { answers?: AnswerRec[]; current?: { n: number; startedAtMs: number } | null }

/** Hands out one round. The answer is never sent, and the round's clock starts here, on the server. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (typeof body?.n !== 'number') return NextResponse.json({ error: 'bad_body' }, { status: 400 });

  const admin = createAdminClient();
  const look = await loadSession(admin, id, user.id, 'market_detective');
  if (!look.ok) return sessionProblem(look);
  const session = look.session;

  const spec = { level: session.level, boosts: session.boosts as BoostKind[] };
  const state = (session.state ?? {}) as State;
  const answers = state.answers ?? [];
  if (body.n !== answers.length || body.n >= detectiveConfig(spec).rounds) return NextResponse.json({ error: 'bad_round' }, { status: 409 });

  const now = Date.now() - new Date(session.started_at).getTime();
  // Asking for the same round again never restarts its clock.
  const cur = state.current;
  const sameRound = !!cur && cur.n === body.n;
  const startedAtMs = sameRound && cur ? cur.startedAtMs : now;
  if (!sameRound) {
    const saved = await saveState(admin, id, user.id, session.state_version, { answers, current: { n: body.n, startedAtMs } });
    if (saved === 'error') return NextResponse.json({ error: 'schema_out_of_date', hint: 'Apply the pending Supabase migrations (0003 and 0006).' }, { status: 500 });
    if (saved === 'conflict') return NextResponse.json({ error: 'conflict' }, { status: 409 });
  }
  const round = publicRound(buildRound(Number(session.seed), body.n, spec), spec, Number(session.seed));
  return NextResponse.json({ round, remainingMs: Math.max(0, round.roundMs - (now - startedAtMs)) });
}
