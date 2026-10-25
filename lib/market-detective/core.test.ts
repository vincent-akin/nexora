import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DETECTIVE_MAX_LEVEL, SERIES_LENGTH, applyAnswer, buildRound, crossedOutFor, detectiveCleared, detectiveConfig, detectiveRewardFor, finalizeDetective,
  publicRound, replayDetective, roundScore, validateDetective,
} from './core.ts';
import type { AnswerRec, DetectiveSpec } from './core.ts';

const at = (level: number, boosts: DetectiveSpec['boosts'] = []): DetectiveSpec => ({ level, boosts });
const LEVELS = Array.from({ length: DETECTIVE_MAX_LEVEL }, (_, i) => i + 1);

/** Plays every round, answering correctly when `skill(n)` is true. */
function play(seed: number, spec: DetectiveSpec, skill: (n: number) => boolean, ms: (n: number) => number): AnswerRec[] {
  const cfg = detectiveConfig(spec);
  const recs: AnswerRec[] = [];
  for (let n = 0; n < cfg.rounds; n++) {
    const r = buildRound(seed, n, spec);
    const wrong = (r.answer + 1) % cfg.options;
    recs.push({ n, choice: skill(n) ? r.answer : wrong, ms: ms(n) });
  }
  return recs;
}

test('the ladder gets harder: more rounds, less time, more companies, closer calls', () => {
  const first = detectiveConfig(at(1));
  const last = detectiveConfig(at(DETECTIVE_MAX_LEVEL));
  assert.ok(last.rounds > first.rounds && last.roundMs < first.roundMs && last.options > first.options && last.minMargin < first.minMargin);
  for (let l = 2; l <= DETECTIVE_MAX_LEVEL; l++) {
    const a = detectiveConfig(at(l - 1)), b = detectiveConfig(at(l));
    assert.ok(b.rounds >= a.rounds && b.roundMs <= a.roundMs && b.options >= a.options && b.minMargin <= a.minMargin, `level ${l} is not easier than ${l - 1}`);
  }
  assert.ok(detectiveConfig(at(DETECTIVE_MAX_LEVEL)).roundMs >= 9000, 'there is always time to read a chart');
  assert.deepEqual(detectiveConfig(at(999)), detectiveConfig(at(DETECTIVE_MAX_LEVEL)), 'levels are clamped');
});

test('rounds are deterministic, well formed, and have a clear winner at every level', () => {
  for (const level of LEVELS) {
    const spec = at(level);
    const cfg = detectiveConfig(spec);
    for (let n = 0; n < cfg.rounds; n++) {
      const a = buildRound(77, n, spec);
      assert.deepEqual(a, buildRound(77, n, spec));
      assert.equal(a.options.length, cfg.options);
      assert.equal(new Set(a.options.map((o) => o.ticker)).size, cfg.options, 'distinct companies');
      assert.ok(a.options.every((o) => o.series.length === SERIES_LENGTH && o.series[0] === 100 && o.series.every((v) => v > 0)));
      const pick = a.metrics[a.answer];
      const rest = a.metrics.filter((_, i) => i !== a.answer);
      if (a.kind === 'lowest_return') assert.ok(rest.every((m) => m > pick));
      else assert.ok(rest.every((m) => m < pick));
    }
    assert.notDeepEqual(buildRound(77, 0, spec), buildRound(78, 0, spec));
  }
});

test('the public round never carries the answer or the metrics', () => {
  const p = publicRound(buildRound(5, 0, at(8)));
  assert.deepEqual(Object.keys(p).sort(), ['index', 'kind', 'options', 'prompt', 'roundMs']);
  assert.ok(!JSON.stringify(p).includes('answer') && !JSON.stringify(p).includes('metrics'));
});

test('question kinds widen with the level', () => {
  const kinds = (l: number) => new Set(Array.from({ length: detectiveConfig(at(l)).rounds }, (_, n) => buildRound(1, n, at(l)).kind));
  assert.deepEqual([...kinds(1)], ['highest_return']);
  assert.equal(kinds(4).size, 2);
  assert.equal(kinds(9).size, 3);
});

test('boost: extra time adds ten seconds a round and changes nothing else', () => {
  const plain = detectiveConfig(at(5)), boosted = detectiveConfig(at(5, ['time']));
  assert.equal(boosted.roundMs, plain.roundMs + 10000);
  assert.deepEqual({ ...boosted, roundMs: 0 }, { ...plain, roundMs: 0 });
  // the same charts, so the boost cannot be used to change the puzzle
  assert.deepEqual(buildRound(4, 1, at(5)).options, buildRound(4, 1, at(5, ['time'])).options);
});

test('boost: cross out two removes only wrong answers, the same two every time, and only with the boost', () => {
  for (const level of LEVELS) for (let n = 0; n < 4; n++) {
    const spec = at(level, ['hint']);
    const r = buildRound(21, n, spec);
    const out = crossedOutFor(r, 21);
    assert.deepEqual(out, crossedOutFor(r, 21));
    assert.ok(!out.includes(r.answer), 'never crosses out the right answer');
    assert.equal(out.length, Math.min(2, r.options.length - 2));
    assert.deepEqual(publicRound(r, spec, 21).crossedOut, out);
    assert.equal(publicRound(r, at(level), 21).crossedOut, undefined);
  }
});

test('scoring: correct answers earn a speed bonus and a streak multiplier, wrong answers nothing', () => {
  assert.equal(roundScore(false, 1000, 20000, 3), 0);
  assert.ok(roundScore(true, 2000, 20000, 0) > roundScore(true, 15000, 20000, 0));
  assert.equal(roundScore(true, 20000, 20000, 0), 100);
  assert.equal(roundScore(true, 20000, 20000, 2), 150);
  const spec = at(4);
  const all = play(3, spec, () => true, () => 6000);
  const none = play(3, spec, () => false, () => 6000);
  assert.equal(replayDetective(3, spec, none).score, 0);
  const s = replayDetective(3, spec, all);
  assert.equal(s.correct, detectiveConfig(spec).rounds);
  assert.equal(s.bestStreak, detectiveConfig(spec).rounds);
  assert.ok(s.done);
});

test('answer rules: in order, valid choice, timeouts, and no answers after the end', () => {
  const spec = at(4);
  assert.deepEqual(applyAnswer(9, spec, [], 1, 0, 3000), { ok: false, reason: 'bad_round' });
  assert.deepEqual(applyAnswer(9, spec, [], 0, 9, 3000), { ok: false, reason: 'bad_choice' });
  const r0 = buildRound(9, 0, spec);
  const ok = applyAnswer(9, spec, [], 0, r0.answer, 3000);
  assert.ok(ok.ok && ok.correct && ok.answerIndex === r0.answer);
  // A late answer counts as a timeout even if the choice was right.
  const late = applyAnswer(9, spec, [], 0, r0.answer, detectiveConfig(spec).roundMs + 5000);
  assert.ok(late.ok && !late.correct && late.answers[0].choice === -1);
  const full = play(9, spec, () => true, () => 4000);
  assert.deepEqual(applyAnswer(9, spec, full, full.length, 0, 1000), { ok: false, reason: 'already_done' });
});

test('thoughtful play is accepted; instant or metronomic answers are flagged; tampered logs rejected', () => {
  const spec = at(4);
  const human = play(11, spec, (n) => n !== 2, (n) => 4500 + n * 1300);
  const v = validateDetective(11, spec, human);
  assert.equal(v.verdict, 'accepted', JSON.stringify(v));
  assert.ok(detectiveRewardFor(v.final!, spec, v.verdict).airdropPoints >= 1);
  assert.ok(detectiveCleared(v.final!), 'five out of six right clears the level');

  const bot = play(11, spec, () => true, () => 300);
  const vb = validateDetective(11, spec, bot);
  assert.equal(vb.verdict, 'flagged');
  assert.ok(vb.flags.includes('inhuman_speed') && vb.flags.includes('uniform_timing'));
  assert.equal(detectiveRewardFor(vb.final!, spec, vb.verdict).airdropPoints, 0);

  assert.deepEqual(validateDetective(11, spec, [{ n: 3, choice: 0, ms: 1000 }]).reasons, ['bad_round']);
  assert.equal(finalizeDetective(11, spec, []).score, 0);
});

test('rewards grow with the level, and a boosted run never earns Airdrop Points', () => {
  const final = { score: 900, correct: 6, rounds: 6, quality: 1, bestStreak: 6, medianMs: 4000 };
  const low = detectiveRewardFor(final, at(1), 'accepted');
  const high = detectiveRewardFor(final, at(DETECTIVE_MAX_LEVEL), 'accepted');
  assert.ok(high.xp > low.xp && high.coins > low.coins);
  assert.ok(high.airdropPoints >= low.airdropPoints && high.airdropPoints > 0);
  const boosted = detectiveRewardFor(final, at(DETECTIVE_MAX_LEVEL, ['hint']), 'accepted');
  assert.equal(boosted.airdropPoints, 0);
  assert.equal(boosted.xp, high.xp, 'XP and Coins are still paid');
  assert.deepEqual(detectiveRewardFor(final, at(3), 'rejected'), { xp: 0, coins: 0, airdropPoints: 0 });
});
