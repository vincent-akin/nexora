import { NextResponse } from 'next/server';
import { beatConfig } from '@/lib/beat-lanes/core';
import { startRun } from '@/lib/run-start';

export async function POST(request: Request) {
  const run = await startRun(request, 'beat_lanes', 'beat-lanes-v2');
  if (run instanceof NextResponse) return run;
  return NextResponse.json({
    sessionId: run.sessionId, seed: run.seed, level: run.level, boosts: run.boosts, hearts: beatConfig({ level: run.level, boosts: run.boosts }).maxMisses,
    expiresAt: run.expiresAt, stamina: run.stamina,
  });
}
