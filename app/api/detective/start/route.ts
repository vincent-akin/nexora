import { NextResponse } from 'next/server';
import { detectiveConfig } from '@/lib/market-detective/core';
import { startRun } from '@/lib/run-start';

export async function POST(request: Request) {
  // The seed stays on the server. Rounds and answers are generated from it, one round at a time.
  const run = await startRun(request, 'market_detective', 'market-detective-v2');
  if (run instanceof NextResponse) return run;
  const cfg = detectiveConfig({ level: run.level, boosts: run.boosts });
  return NextResponse.json({
    sessionId: run.sessionId, level: run.level, boosts: run.boosts, rounds: cfg.rounds, roundMs: cfg.roundMs, options: cfg.options, stamina: run.stamina,
  });
}
