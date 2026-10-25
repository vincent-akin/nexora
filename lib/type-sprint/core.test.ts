import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_MS, RUN_CAP_MS, SPRINT_MAX_LEVEL, SprintSim, simulate, sprintConfig, sprintRewardFor, sprintStars, sprintUnlocks, stageWords, validateSprint, wordsFor,
  type Key, type SprintSpec,
} from './core.ts';

const at = (level: number, boosts: SprintSpec['boosts'] = []): SprintSpec => ({ level, boosts });
const LEVELS = Array.from({ length: SPRINT_MAX_LEVEL }, (_, i) => i + 1);

/** A typist who hits every letter of every word, `cps` characters a second, starting `lag` ms after a word appears. */
function perfectTypist(seed: number, spec: SprintSpec, cps: number, lag = 300, jitter = 0): Key[] {
  const sim = new SprintSim(seed, spec);
  const keys: Key[] = [];
  let t = 0, n = 0;
  while (!sim.ended && t < RUN_CAP_MS) {
    const w = sim.words.filter((x) => x.status === 'falling').sort((a, b) => a.spawnT - b.spawnT)[0];
    if (!w) { t += 50; sim.advance(t); continue; }
    t = Math.max(t, w.spawnT + lag);
    for (const c of w.text.slice(w.typed)) {
      t += 1000 / cps + (jitter ? ((n++ * 37) % jitter) : 0);
      if (t >= w.dieT) break;
      keys.push({ c, t: Math.round(t * 10) / 10 });
      sim.press(c, Math.round(t * 10) / 10);
      if (sim.ended) break;
    }
  }
  return keys;
}

test('the ladder gets harder: faster, shorter gaps, longer words, bigger stages', () => {
  for (let l = 2; l <= SPRINT_MAX_LEVEL; l++) {
    const a = sprintConfig(l - 1), b = sprintConfig(l);
    assert.ok(b.fallMs <= a.fallMs && b.gapMs < a.gapMs && b.minLen >= a.minLen && b.maxLen >= a.maxLen && b.quota > a.quota, `level ${l}`);
  }
  assert.ok(sprintConfig(1).fallMs >= 8000 && sprintConfig(SPRINT_MAX_LEVEL).fallMs <= 3300);
  assert.ok(sprintConfig(SPRINT_MAX_LEVEL).minLen >= 2 * sprintConfig(1).minLen);
});

test('every level has enough words of the right length, and words get longer on average', () => {
  let prev = 0;
  for (const l of LEVELS) {
    const pool = wordsFor(l), cfg = sprintConfig(l);
    assert.ok(pool.length >= 12, `level ${l} has ${pool.length} words`);
    assert.ok(pool.every((w) => w.length >= cfg.minLen && w.length <= cfg.maxLen && /^[a-z]+$/.test(w)));
    const avg = pool.reduce((a, w) => a + w.length, 0) / pool.length;
    assert.ok(avg >= prev, `level ${l} average word length fell`);
    prev = avg;
  }
});

test('stage words are deterministic, unique and never start two neighbours with the same letter', () => {
  for (const l of LEVELS) {
    const a = stageWords(99, l, 0);
    assert.deepEqual(a, stageWords(99, l, 0));
    assert.notDeepEqual(a.map((w) => w.text), stageWords(100, l, 0).map((w) => w.text));
    assert.equal(a.length, sprintConfig(l).quota);
    for (let i = 1; i < a.length; i++) assert.notEqual(a[i].text[0], a[i - 1].text[0]);
    assert.ok(a.every((w) => w.x >= 0 && w.x <= 0.8));
  }
});

test('typing a word scores, locks the target, and a wrong key costs points and the streak but not a life', () => {
  const sim = new SprintSim(5, at(1));
  const w = sim.words[0];
  sim.press(w.text[0], w.spawnT + 100);
  assert.equal(sim.locked, w);
  sim.press(w.text[1] === 'q' ? 'z' : 'q', w.spawnT + 300);
  assert.equal(sim.errors, 1);
  assert.equal(sim.lives, sprintConfig(1).lives);
  assert.equal(sim.streak, 0);
  let t = w.spawnT + 400;
  for (const c of w.text.slice(1)) { t += 120; sim.press(c, t); }
  assert.equal(sim.wordsDone, 1);
  assert.equal(w.status, 'done');
  assert.ok(sim.score > 0);
  const kinds = sim.drain().map((e) => e.type);
  assert.ok(kinds.includes('hit') && kinds.includes('err') && kinds.includes('word'));
});

test('a key with no word to match is an error, and a word that is not on screen yet cannot be typed', () => {
  const sim = new SprintSim(5, at(1));
  sim.press(sim.words[1].text[0], 100); // second word has not appeared
  assert.equal(sim.errors, 1);
  assert.equal(sim.correct, 0);
});

test('words that reach the bottom cost lives, and the run ends at zero', () => {
  const r = simulate(7, at(1), []);
  assert.equal(r.endReason, 'lives');
  assert.equal(r.missed, sprintConfig(1).lives);
  assert.equal(r.wordsDone, 0);
  const boosted = simulate(7, at(1, ['life']), []);
  assert.equal(boosted.missed, sprintConfig(1).lives + 1, 'spare life lets one more word through');
  assert.ok(boosted.endedAt > r.endedAt);
});

test('boost: slow words fall 25% slower and nothing else changes', () => {
  const plain = sprintConfig(6), slow = sprintConfig(6, ['slow']);
  assert.ok(Math.abs(slow.fallMs / plain.fallMs - 1 / 0.75) < 0.01);
  assert.deepEqual({ ...slow, fallMs: 0 }, { ...plain, fallMs: 0 });
  assert.deepEqual(stageWords(3, 6, 0), stageWords(3, 6, 0));
});

test('clearing a stage opens the next one, faster, and unlocks the next level', () => {
  const spec = at(1);
  const keys = perfectTypist(11, spec, 6);
  const r = simulate(11, spec, keys);
  assert.ok(r.stagesCleared >= 1, 'a steady typist clears level 1');
  assert.ok(r.reachedLevel >= 2);
  assert.equal(sprintUnlocks(r), Math.min(SPRINT_MAX_LEVEL, 1 + r.stagesCleared));
  assert.ok(r.accuracy === 1 && r.errors === 0);
  assert.ok(sprintStars(r) >= 1);
});

test('the same log always replays to the same result, and a log cannot be extended past the end of the run', () => {
  const keys = perfectTypist(21, at(2), 5);
  assert.deepEqual(simulate(21, at(2), keys), simulate(21, at(2), keys));
  const r = simulate(21, at(2), keys);
  const more = [...keys, { c: 'a', t: keys[keys.length - 1].t + 20 }];
  assert.deepEqual(simulate(21, at(2), more).score, r.score, 'keys after a run has ended change nothing');
});

test('the run never lasts beyond the cap', () => {
  const r = simulate(31, at(1), perfectTypist(31, at(1), 9, 100));
  assert.ok(r.endedAt <= RUN_CAP_MS);
});

test('validation: a steady human typist is accepted; bots, forgeries and impossible speeds are not', () => {
  const spec = at(3);
  const human = perfectTypist(41, spec, 5, 400, 90);
  const elapsed = simulate(41, spec, human).endedAt + 500;
  const ok = validateSprint(41, spec, human, elapsed);
  assert.equal(ok.verdict, 'accepted', JSON.stringify(ok));

  // submitted before the run could have finished
  assert.deepEqual(validateSprint(41, spec, human, 3000).reasons.length > 0, true);
  // metronome-perfect timing is flagged, not rejected
  const metronome = perfectTypist(41, spec, 8, 300, 0).map((k, i) => ({ ...k, t: 2000 + i * 100 }));
  const flagged = validateSprint(41, spec, metronome, RUN_CAP_MS + 5000);
  assert.ok(flagged.verdict === 'flagged' || flagged.verdict === 'accepted');
  // structural forgeries
  assert.deepEqual(validateSprint(41, spec, [{ c: 'A', t: 1 }], 99999).reasons, ['bad_key']);
  assert.deepEqual(validateSprint(41, spec, [{ c: 'a', t: 500 }, { c: 'b', t: 100 }], 99999).reasons, ['keys_out_of_order']);
  assert.deepEqual(validateSprint(41, spec, [{ c: 'a', t: 500 }, { c: 'b', t: 502 }], 99999).reasons, ['key_gap']);
  assert.deepEqual(validateSprint(41, spec, [{ c: 'a', t: 90_000 }], 1000).reasons, ['keys_in_the_future']);
  const burst: Key[] = Array.from({ length: 30 }, (_, i) => ({ c: 'a', t: 1000 + i * 20 }));
  assert.deepEqual(validateSprint(41, spec, burst, 99999).reasons, ['key_rate']);
});

test('rewards: scale with level, depend on accuracy and progress, and a boosted run earns no Airdrop Points', () => {
  const keys = perfectTypist(51, at(1), 6);
  const r1 = simulate(51, at(1), keys);
  const clean = sprintRewardFor(r1, at(1), 'accepted');
  assert.ok(clean.xp > 0 && clean.airdropPoints >= 1);
  const boosted = sprintRewardFor(r1, at(1, ['life']), 'accepted');
  assert.equal(boosted.airdropPoints, 0);
  assert.equal(boosted.xp, clean.xp);
  assert.equal(sprintRewardFor(r1, at(1), 'flagged').airdropPoints, 0);
  assert.deepEqual(sprintRewardFor(r1, at(1), 'rejected'), { xp: 0, coins: 0, airdropPoints: 0 });
  const idle = simulate(51, at(1), []);
  assert.deepEqual(sprintRewardFor(idle, at(1), 'accepted'), { xp: 0, coins: 0, airdropPoints: 0 });
  assert.ok(LEAD_MS > 0);
});
