import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTY,
  LANES,
  WINDOWS,
  evaluateRun,
  generateChart,
  mulberry32,
  rewardFor,
  validateSubmission,
} from './core.ts';
import type { Difficulty, Note, Tap } from './core.ts';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

/** Taps with human-like timing noise (Box-Muller around the note time). */
function humanTaps(chart: Note[], sd: number, seed: number): Tap[] {
  const rnd = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  return chart
    .map((n) => ({ lane: n.lane, t: Math.round(n.t + gauss() * sd) }))
    .sort((a, b) => a.t - b.t);
}

const exactTaps = (chart: Note[]): Tap[] => chart.map((n) => ({ lane: n.lane, t: n.t }));
const elapsedFor = (chart: Note[]) => chart[chart.length - 1].t + 2000;

test('charts are deterministic and well formed', () => {
  for (const d of DIFFS) {
    const a = generateChart(12345, d);
    const b = generateChart(12345, d);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, generateChart(54321, d));
    assert.ok(a.length > 40, `${d} has enough notes`);
    for (let i = 0; i < a.length; i++) {
      assert.ok(a[i].lane >= 0 && a[i].lane < LANES);
      assert.ok(a[i].t <= DIFFICULTY[d].durationMs);
      if (i > 0) {
        assert.ok(a[i].t > a[i - 1].t);
        // Windows of consecutive notes must never overlap.
        assert.ok(a[i].t - a[i - 1].t > 2 * WINDOWS.goodMs, `${d} gap at ${i}`);
      }
    }
  }
});

test('perfect play scores full accuracy and completes', () => {
  const chart = generateChart(7, 'normal');
  const r = evaluateRun(chart, exactTaps(chart), 'normal');
  assert.equal(r.perfects, chart.length);
  assert.equal(r.misses + r.strays, 0);
  assert.equal(r.accuracy, 1);
  assert.equal(r.completed, true);
  assert.equal(r.maxCombo, chart.length);
});

test('good window, perfect window and offset', () => {
  const chart = generateChart(7, 'easy');
  const late = chart.map((n) => ({ lane: n.lane, t: n.t + 80 }));
  const r = evaluateRun(chart, late, 'easy');
  assert.equal(r.goods, chart.length);
  assert.equal(r.perfects, 0);
  // Calibrating the 80 ms latency away turns every good into a perfect.
  const fixed = evaluateRun(chart, late, 'easy', 80);
  assert.equal(fixed.perfects, chart.length);
  // Taps at exactly the window edge still count.
  const edge = evaluateRun(chart, chart.map((n) => ({ lane: n.lane, t: n.t + WINDOWS.goodMs })), 'easy');
  assert.equal(edge.goods, chart.length);
  const outside = evaluateRun(chart, chart.map((n) => ({ lane: n.lane, t: n.t + WINDOWS.goodMs + 1 })), 'easy');
  assert.equal(outside.goods, 0);
});

test('stray taps and misses end the run at the miss limit', () => {
  const chart = generateChart(9, 'hard');
  const spam: Tap[] = [];
  for (let t = 0; t < 20000; t += 70) spam.push({ lane: (t / 70) % LANES, t });
  const r = evaluateRun(chart, spam, 'hard');
  assert.equal(r.completed, false);
  assert.ok(r.strays + r.misses >= DIFFICULTY.hard.maxMisses);
  assert.ok(r.accuracy < 0.5);
  const idle = evaluateRun(chart, [], 'easy');
  assert.equal(idle.completed, false);
  assert.equal(idle.score, 0);
});

test('a run in progress can be evaluated up to a point in time', () => {
  const chart = generateChart(7, 'normal');
  const half = evaluateRun(chart, exactTaps(chart), 'normal', 0, 20000);
  assert.ok(half.perfects > 0 && half.perfects < chart.length);
  assert.equal(half.grades.filter((g) => g === null).length, chart.length - half.perfects);
});

test('human-like play is accepted and rewarded', () => {
  const chart = generateChart(21, 'normal');
  const v = validateSubmission({
    chart, taps: humanTaps(chart, 25, 99), difficulty: 'normal', offsetMs: 0, serverElapsedMs: elapsedFor(chart),
  });
  assert.equal(v.verdict, 'accepted', JSON.stringify(v));
  const reward = rewardFor(v.result!, 'normal', v.verdict);
  assert.ok(reward.xp > 0 && reward.coins > 0 && reward.airdropPoints === 2);
});

test('machine-perfect play is flagged and earns no Airdrop Points', () => {
  const chart = generateChart(21, 'normal');
  const v = validateSubmission({
    chart, taps: exactTaps(chart), difficulty: 'normal', offsetMs: 0, serverElapsedMs: elapsedFor(chart),
  });
  assert.equal(v.verdict, 'flagged');
  assert.ok(v.flags.includes('uniform_timing'));
  const reward = rewardFor(v.result!, 'normal', v.verdict);
  assert.equal(reward.airdropPoints, 0);
  assert.ok(reward.xp > 0);
});

test('forged submissions are rejected', () => {
  const chart = generateChart(21, 'normal');
  const taps = humanTaps(chart, 25, 99);
  const base = { chart, difficulty: 'normal' as const, offsetMs: 0 };

  // A 60 second run "completed" in 10 seconds of server time.
  assert.deepEqual(validateSubmission({ ...base, taps, serverElapsedMs: 10000 }).reasons.includes('run_too_fast'), true);
  // Taps stamped after the session even ended.
  assert.ok(validateSubmission({ ...base, taps, serverElapsedMs: 30000 }).reasons.includes('taps_in_the_future'));
  // Out-of-order and malformed logs.
  assert.deepEqual(
    validateSubmission({ ...base, taps: [{ lane: 0, t: 500 }, { lane: 1, t: 400 }], serverElapsedMs: 60000 }).reasons,
    ['taps_out_of_order'],
  );
  assert.deepEqual(
    validateSubmission({ ...base, taps: [{ lane: 9, t: 500 }], serverElapsedMs: 60000 }).reasons,
    ['malformed_tap'],
  );
  assert.deepEqual(
    validateSubmission({ ...base, taps, offsetMs: 900, serverElapsedMs: elapsedFor(chart) }).reasons,
    ['offset_out_of_range'],
  );
  // Inhuman tap rate: 20 taps inside one second.
  const burst: Tap[] = Array.from({ length: 20 }, (_, i) => ({ lane: i % LANES, t: 3000 + i * 40 }));
  assert.ok(validateSubmission({ ...base, taps: burst, serverElapsedMs: 60000 }).reasons.includes('tap_rate'));
  // Padding the log with thousands of taps.
  const huge: Tap[] = Array.from({ length: 5000 }, (_, i) => ({ lane: 0, t: i * 10 }));
  assert.deepEqual(validateSubmission({ ...base, taps: huge, serverElapsedMs: 60000 }).reasons, ['too_many_taps']);
});

test('rejected runs earn nothing', () => {
  const chart = generateChart(3, 'easy');
  const r = evaluateRun(chart, exactTaps(chart), 'easy');
  assert.deepEqual(rewardFor(r, 'easy', 'rejected'), { xp: 0, coins: 0, airdropPoints: 0 });
});
