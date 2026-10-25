import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEAT_MAX_LEVEL,
  LANES,
  WINDOWS,
  beatCleared,
  beatConfig,
  earlyWindowMs,
  evaluateRun,
  generateChart,
  mulberry32,
  rewardFor,
  validateSubmission,
} from './core.ts';
import type { BeatSpec, Note, Tap } from './core.ts';

const L = (level: number, boosts: BeatSpec['boosts'] = []): BeatSpec => ({ level, boosts });
/** The bottom, middle and top of the ladder. */
const EASY = L(1), NORMAL = L(5), HARD = L(10);
const DIFFS: BeatSpec[] = [EASY, NORMAL, HARD];

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
      assert.ok(a[i].t <= beatConfig(d).durationMs);
      if (i > 0) {
        assert.ok(a[i].t > a[i - 1].t);
        // Windows of consecutive notes must never overlap.
        assert.ok(a[i].t - a[i - 1].t > 2 * WINDOWS.goodMs, `${d} gap at ${i}`);
      }
    }
  }
});

test('perfect play scores full accuracy and completes', () => {
  const chart = generateChart(7, NORMAL);
  const r = evaluateRun(chart, exactTaps(chart), NORMAL);
  assert.equal(r.perfects, chart.length);
  assert.equal(r.misses + r.strays, 0);
  assert.equal(r.accuracy, 1);
  assert.equal(r.completed, true);
  assert.equal(r.maxCombo, chart.length);
});

test('good window, perfect window and offset', () => {
  const chart = generateChart(7, EASY);
  const late = chart.map((n) => ({ lane: n.lane, t: n.t + 80 }));
  const r = evaluateRun(chart, late, EASY);
  assert.equal(r.goods, chart.length);
  assert.equal(r.perfects, 0);
  // Calibrating the 80 ms latency away turns every good into a perfect.
  const fixed = evaluateRun(chart, late, EASY, 80);
  assert.equal(fixed.perfects, chart.length);
  // Taps at exactly the window edge still count.
  const edge = evaluateRun(chart, chart.map((n) => ({ lane: n.lane, t: n.t + WINDOWS.goodMs })), EASY);
  assert.equal(edge.goods, chart.length);
  const outside = evaluateRun(chart, chart.map((n) => ({ lane: n.lane, t: n.t + WINDOWS.goodMs + 1 })), EASY);
  assert.equal(outside.goods, 0);
});

test('an early tap pops the tile: little credit, no life lost, combo untouched', () => {
  const chart = generateChart(7, EASY);
  const early = chart.map((n) => ({ lane: n.lane, t: n.t - 500 }));
  const r = evaluateRun(chart, early, EASY);
  assert.equal(r.earlies, chart.length);
  assert.equal(r.misses + r.strays, 0);
  assert.equal(r.completed, true);
  assert.equal(r.combo, 0);
  assert.equal(r.accuracy, 0.25);
  assert.ok(r.score > 0);
  // Every tile popped, so nothing is left to miss.
  assert.ok(r.grades.every((g) => g === 'early'));
});

test('a tap before the tile is on screen is an empty tap', () => {
  const chart = generateChart(7, EASY);
  const tooSoon = earlyWindowMs(EASY) + 50;
  const r = evaluateRun(chart, [{ lane: chart[0].lane, t: chart[0].t - tooSoon }], EASY, 0, chart[0].t - tooSoon);
  assert.equal(r.strays, 1);
  assert.equal(r.earlies, 0);
});

test('button mashing never reaches the Airdrop Points threshold', () => {
  const chart = generateChart(9, HARD);
  const mash: Tap[] = [];
  for (let t = 0; t < 76000; t += 75) mash.push({ lane: Math.floor(t / 75) % LANES, t });
  const r = evaluateRun(chart, mash, HARD);
  assert.ok(r.accuracy < 0.5, `accuracy ${r.accuracy}`);
  assert.equal(rewardFor(r, HARD, 'accepted').airdropPoints, 0);
});

test('an idle run ends at the miss limit', () => {
  const idle = evaluateRun(generateChart(9, EASY), [], EASY);
  assert.equal(idle.completed, false);
  assert.equal(idle.score, 0);
});

test('a run in progress can be evaluated up to a point in time', () => {
  const chart = generateChart(7, NORMAL);
  const half = evaluateRun(chart, exactTaps(chart), NORMAL, 0, 20000);
  assert.ok(half.perfects > 0 && half.perfects < chart.length);
  assert.equal(half.grades.filter((g) => g === null).length, chart.length - half.perfects);
});

test('human-like play is accepted and rewarded', () => {
  const chart = generateChart(21, NORMAL);
  const v = validateSubmission({
    chart, taps: humanTaps(chart, 25, 99), spec: NORMAL, offsetMs: 0, serverElapsedMs: elapsedFor(chart),
  });
  assert.equal(v.verdict, 'accepted', JSON.stringify(v));
  const reward = rewardFor(v.result!, NORMAL, v.verdict);
  assert.ok(reward.xp > 0 && reward.coins > 0 && reward.airdropPoints === 2);
});

test('machine-perfect play is flagged and earns no Airdrop Points', () => {
  const chart = generateChart(21, NORMAL);
  const v = validateSubmission({
    chart, taps: exactTaps(chart), spec: NORMAL, offsetMs: 0, serverElapsedMs: elapsedFor(chart),
  });
  assert.equal(v.verdict, 'flagged');
  assert.ok(v.flags.includes('uniform_timing'));
  const reward = rewardFor(v.result!, NORMAL, v.verdict);
  assert.equal(reward.airdropPoints, 0);
  assert.ok(reward.xp > 0);
});

test('forged submissions are rejected', () => {
  const chart = generateChart(21, NORMAL);
  const taps = humanTaps(chart, 25, 99);
  const base = { chart, spec: NORMAL, offsetMs: 0 };

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
  const chart = generateChart(3, EASY);
  const r = evaluateRun(chart, exactTaps(chart), EASY);
  assert.deepEqual(rewardFor(r, EASY, 'rejected'), { xp: 0, coins: 0, airdropPoints: 0 });
});

test('the ladder gets harder on every axis, one small step at a time', () => {
  for (let l = 2; l <= BEAT_MAX_LEVEL; l++) {
    const a = beatConfig(L(l - 1)), b = beatConfig(L(l));
    assert.ok(b.bpm >= a.bpm && b.density >= a.density && b.travelMs <= a.travelMs && b.maxMisses <= a.maxMisses && b.durationMs >= a.durationMs, `level ${l}`);
  }
  assert.ok(beatConfig(L(1)).bpm < beatConfig(L(BEAT_MAX_LEVEL)).bpm && beatConfig(L(1)).maxMisses > beatConfig(L(BEAT_MAX_LEVEL)).maxMisses);
  assert.deepEqual(beatConfig(L(99)), beatConfig(L(BEAT_MAX_LEVEL)));
});

test('every level builds a chart that cannot be ambiguous: notes in one lane are far enough apart', () => {
  for (let l = 1; l <= BEAT_MAX_LEVEL; l++) {
    const chart = generateChart(5, L(l));
    const lastByLane: number[] = [];
    for (const n of chart) {
      if (lastByLane[n.lane] !== undefined) assert.ok(n.t - lastByLane[n.lane] > 2 * WINDOWS.goodMs, `level ${l}`);
      lastByLane[n.lane] = n.t;
    }
    assert.ok(chart.length > 20);
  }
});

test('boost: extra hearts adds three hearts and leaves the chart alone', () => {
  assert.equal(beatConfig(L(4, ['life'])).maxMisses, beatConfig(L(4)).maxMisses + 3);
  assert.deepEqual(generateChart(8, L(4, ['life'])), generateChart(8, L(4)));
  const chart = generateChart(8, L(4));
  const mash: Tap[] = Array.from({ length: 200 }, (_, i) => ({ lane: i % LANES, t: 2000 + i * 230 }));
  const plain = evaluateRun(chart, mash, L(4)), boosted = evaluateRun(chart, mash, L(4, ['life']));
  assert.ok((boosted.endedAtMs ?? Infinity) >= (plain.endedAtMs ?? 0), 'extra hearts let a bad run last at least as long');
});

test('rewards grow with the level; boosted runs earn no Airdrop Points; a level clears on a finished song at 60%', () => {
  const chart = generateChart(3, L(1));
  const r = evaluateRun(chart, exactTaps(chart), L(1));
  assert.ok(beatCleared(r));
  const low = rewardFor(r, L(1), 'accepted'), high = rewardFor(r, L(BEAT_MAX_LEVEL), 'accepted');
  assert.ok(high.xp > low.xp && high.coins > low.coins && low.airdropPoints >= 1);
  const boosted = rewardFor(r, L(1, ['life']), 'accepted');
  assert.equal(boosted.airdropPoints, 0);
  assert.equal(boosted.xp, low.xp);
  assert.equal(beatCleared(evaluateRun(chart, [], L(1))), false);
});
