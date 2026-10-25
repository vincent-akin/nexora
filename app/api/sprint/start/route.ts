import { NextResponse } from 'next/server';
import { sprintConfig } from '@/lib/type-sprint/core';
import { startRun } from '@/lib/run-start';

export async function POST(request: Request) {
  const run = await startRun(request, 'type_sprint', 'type-sprint-v2');
  if (run instanceof NextResponse) return run;
  // The word list is not a secret: the player has to see it. Only the typing is checked.
  return NextResponse.json({
    sessionId: run.sessionId, seed: run.seed, level: run.level, boosts: run.boosts,
    lives: sprintConfig(run.level, run.boosts).lives, stamina: run.stamina,
  });
}
