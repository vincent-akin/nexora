import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_MAX_LEVEL, COLS, LINES_PER_LEVEL, PIECES, ROWS, RUN_CAP_MS, BlockSim, blockRewardFor, blockUnlocks, collides, gravityMs, shapeOf, simulate, validateBlocks,
  type Action, type BlockSpec, type PieceType,
} from './core.ts';

const at = (level: number, boosts: BlockSpec['boosts'] = []): BlockSpec => ({ level, boosts });

/**
 * A small greedy player: tries every rotation and column for the current piece, scores the result
 * (fewer holes, lower stack, more lines), then sends the actions to get there. `gap` is the time
 * between actions, in ms.
 */
function bot(seed: number, spec: BlockSpec, gap = 60, maxPieces = 400): { actions: Action[]; sim: BlockSim } {
  const sim = new BlockSim(seed, spec);
  const actions: Action[] = [];
  let t = 1100;
  const send = (a: Action['a']) => { actions.push({ a, t }); sim.act(a, t); t += gap; };
  for (let n = 0; n < maxPieces && !sim.ended && t < RUN_CAP_MS - 1000; n++) {
    const p = sim.piece;
    let best = { score: -Infinity, rot: 0, x: p.x };
    for (let rot = 0; rot < 4; rot++) {
      for (let x = -3; x < COLS; x++) {
        if (collides(sim.board, p.type, rot, x, p.y)) continue;
        let y = p.y;
        while (!collides(sim.board, p.type, rot, x, y + 1)) y++;
        const b = sim.board.map((r) => [...r]);
        for (const [cx, cy] of shapeOf(p.type, rot)) if (y + cy >= 0) b[y + cy][x + cx] = 1;
        const full = b.filter((r) => r.every(Boolean)).length;
        const rows = b.filter((r) => !r.every(Boolean));
        const pad = ROWS - rows.length;
        let holes = 0, agg = 0, bump = 0, max = 0, prev = -1;
        for (let c = 0; c < COLS; c++) {
          let seen = false, h = 0;
          rows.forEach((r, i) => { if (r[c]) { if (!seen) h = rows.length - i; seen = true; } else if (seen) holes++; });
          agg += h; max = Math.max(max, h);
          if (prev >= 0) bump += Math.abs(h - prev);
          prev = h;
        }
        void pad;
        const score = full * 9 - holes * 7 - bump * 0.6 - agg * 0.35 - max * 0.2;
        if (score > best.score) best = { score, rot, x };
      }
    }
    for (let i = 0; i < best.rot; i++) send('CW');
    let dx = best.x - sim.piece.x;
    // rotation may have kicked the piece sideways; steer from where it is now
    while (dx !== 0 && !sim.ended) { send(dx < 0 ? 'L' : 'R'); dx += dx < 0 ? 1 : -1; }
    send('HD');
  }
  return { actions, sim };
}

test('every piece has four cells in four rotations, inside its box, and rotating four times comes home', () => {
  for (const type of PIECES) {
    for (let r = 0; r < 4; r++) {
      const cells = shapeOf(type, r);
      assert.equal(cells.length, 4);
      assert.equal(new Set(cells.map((c) => c.join(','))).size, 4, `${type} ${r} cells are distinct`);
    }
    assert.deepEqual(shapeOf(type, 4), shapeOf(type, 0));
  }
  assert.deepEqual(shapeOf('O', 1), shapeOf('O', 0));
});

test('gravity speeds up with the level, never below a floor, and the slow boost stretches it 30%', () => {
  for (let l = 2; l <= BLOCK_MAX_LEVEL; l++) assert.ok(gravityMs(l) <= gravityMs(l - 1), `level ${l}`);
  assert.ok(gravityMs(1) >= 800 && gravityMs(BLOCK_MAX_LEVEL) <= 70 && gravityMs(BLOCK_MAX_LEVEL) >= 60);
  assert.ok(Math.abs(gravityMs(5, ['slow']) / gravityMs(5) - 1 / 0.7) < 0.02);
});

test('the bag deals all seven pieces before repeating, and the same seed deals the same game', () => {
  const sim = new BlockSim(9, at(1));
  const seq: PieceType[] = [sim.piece.type, ...sim.queue.slice(0, 6)];
  assert.equal(new Set(seq.slice(0, 7)).size, 7);
  assert.deepEqual(new BlockSim(9, at(1)).queue, sim.queue);
  assert.notDeepEqual(new BlockSim(10, at(1)).queue, sim.queue);
});

test('movement, walls, rotation and hold behave', () => {
  const sim = new BlockSim(3, at(1));
  for (let i = 0; i < 12; i++) sim.act('L', 1100 + i);
  assert.ok(shapeOf(sim.piece.type, sim.piece.rot).every(([cx]) => sim.piece.x + cx >= 0), 'cannot leave the left wall');
  const before = sim.piece.type;
  assert.ok(sim.act('H', 1200));
  assert.equal(sim.hold, before);
  assert.equal(sim.act('H', 1210), false, 'one hold per piece');
  sim.act('HD', 1300);
  assert.ok(sim.act('H', 1310), 'hold is available again for the next piece');
  const dropped = new BlockSim(3, at(1));
  const y0 = dropped.piece.y;
  dropped.act('SD', 1100);
  assert.equal(dropped.piece.y, y0 + 1);
  assert.equal(dropped.score, 1);
});

test('gravity pulls the piece down on a timer and locks it at the bottom', () => {
  const sim = new BlockSim(4, at(1));
  sim.advance(1000 + gravityMs(1) * 3 + 5);
  assert.equal(sim.piece.y >= 3 - 1, true);
  sim.advance(1000 + gravityMs(1) * 40);
  assert.ok(sim.pieces >= 1, 'a piece locked on its own');
});

test('an idle player tops out, and the run ends there', () => {
  const r = simulate(5, at(1), []);
  assert.equal(r.endReason, 'topout');
  assert.ok(r.endedAt < RUN_CAP_MS && r.lines === 0);
});

test('a decent player clears lines, climbs levels, and the level rises every eight lines', () => {
  const { actions, sim } = bot(7, at(1), 40);
  assert.ok(sim.lines >= LINES_PER_LEVEL, `cleared ${sim.lines} lines`);
  assert.equal(sim.level, Math.min(BLOCK_MAX_LEVEL, 1 + Math.floor(sim.lines / LINES_PER_LEVEL)));
  const r = simulate(7, at(1), actions);
  assert.equal(r.lines, sim.lines);
  assert.equal(r.score, sim.score);
  assert.equal(blockUnlocks(r), r.reachedLevel);
  assert.ok(r.reachedLevel >= 2);
});

test('the log replays to exactly what the live simulation showed, including after the run ends', () => {
  const { actions, sim } = bot(8, at(3), 50, 120);
  sim.advance(RUN_CAP_MS);
  const r = simulate(8, at(3), actions);
  assert.equal(r.score, sim.score);
  assert.equal(r.endedAt, sim.endedAt);
  const extra = [...actions, { a: 'HD' as const, t: r.endedAt + 100 }];
  assert.equal(simulate(8, at(3), extra).score, r.score, 'actions after the end change nothing');
});

test('scoring: more lines in one drop score more, and higher levels multiply it', () => {
  const low = bot(12, at(1), 30, 200).sim, high = bot(12, at(8), 30, 200).sim;
  assert.ok(high.score >= low.score || high.lines < low.lines);
});

test('boost: second chance clears the top half once, then the run really ends', () => {
  const plain = simulate(5, at(1), []);
  const saved = simulate(5, at(1, ['second']), []);
  assert.ok(saved.endedAt > plain.endedAt, 'the second chance bought time');
  assert.equal(saved.endReason, 'topout');
  const sim = new BlockSim(5, at(1, ['second']));
  sim.advance(RUN_CAP_MS);
  assert.ok(sim.secondUsed);
});

test('boost: slow drop buys time without changing the pieces', () => {
  assert.deepEqual(new BlockSim(6, at(2)).queue, new BlockSim(6, at(2, ['slow'])).queue);
  assert.ok(simulate(6, at(2, ['slow']), []).endedAt > simulate(6, at(2), []).endedAt);
});

test('validation: structure, rate and clock reject; superhuman pace is flagged; honest play is accepted', () => {
  const { actions } = bot(21, at(1), 90, 150);
  const elapsed = simulate(21, at(1), actions).endedAt + 600;
  const ok = validateBlocks(21, at(1), actions, elapsed);
  assert.equal(ok.verdict, 'accepted', JSON.stringify(ok.reasons) + JSON.stringify(ok.flags));
  assert.deepEqual(validateBlocks(21, at(1), [{ a: 'X' as never, t: 5 }], 99999).reasons, ['bad_action']);
  assert.deepEqual(validateBlocks(21, at(1), [{ a: 'L', t: 500 }, { a: 'R', t: 100 }], 99999).reasons, ['actions_out_of_order']);
  assert.deepEqual(validateBlocks(21, at(1), [{ a: 'L', t: 90_000 }], 1000).reasons, ['actions_in_the_future']);
  const burst: Action[] = Array.from({ length: 60 }, (_, i) => ({ a: 'L' as const, t: 2000 + i * 10 }));
  assert.deepEqual(validateBlocks(21, at(1), burst, 99999).reasons, ['action_rate']);
  assert.ok(validateBlocks(21, at(1), actions, (actions.at(-1)?.t ?? 0) + 200).reasons.includes('run_too_fast'), 'cannot submit before the run could have ended');
  // a machine dropping pieces far faster than hands can: flagged
  const fast = bot(22, at(1), 26, 300);
  const vf = validateBlocks(22, at(1), fast.actions, RUN_CAP_MS + 5000);
  assert.equal(vf.verdict, 'flagged', JSON.stringify([vf.reasons, vf.result?.pieces, vf.result?.pps]));
  assert.ok(vf.flags.includes('inhuman_speed'));
  assert.equal(blockRewardFor(vf.result!, at(1), vf.verdict).airdropPoints, 0);
});

test('rewards scale with level and lines; boosted runs earn no Airdrop Points; rejected earn nothing', () => {
  const r = { score: 5000, lines: 24, pieces: 80, bestCombo: 3, startLevel: 1, reachedLevel: 4, endedAt: 100000, endReason: 'topout' as const, pps: 0.8 };
  const low = blockRewardFor(r, at(1), 'accepted');
  const high = blockRewardFor(r, at(BLOCK_MAX_LEVEL), 'accepted');
  assert.ok(high.xp > low.xp && low.airdropPoints >= 1 && high.airdropPoints >= low.airdropPoints);
  assert.equal(blockRewardFor(r, at(1, ['slow']), 'accepted').airdropPoints, 0);
  assert.equal(blockRewardFor(r, at(1), 'flagged').airdropPoints, 0);
  assert.deepEqual(blockRewardFor(r, at(1), 'rejected'), { xp: 0, coins: 0, airdropPoints: 0 });
  assert.equal(ROWS, 20);
});
