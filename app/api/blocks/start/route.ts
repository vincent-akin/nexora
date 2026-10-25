import { NextResponse } from 'next/server';
import { gravityMs } from '@/lib/block-drop/core';
import { startRun } from '@/lib/run-start';

export async function POST(request: Request) {
  const run = await startRun(request, 'block_drop', 'block-drop-v1');
  if (run instanceof NextResponse) return run;
  // The piece order is not a secret: the player sees the next pieces. Only the play is checked.
  return NextResponse.json({
    sessionId: run.sessionId, seed: run.seed, level: run.level, boosts: run.boosts, gravityMs: gravityMs(run.level, run.boosts), stamina: run.stamina,
  });
}
