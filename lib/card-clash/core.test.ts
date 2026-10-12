import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../beat-lanes/core.ts';
import {
  CARD_CONFIG,
  MIN_FLIP_GAP_MS,
  applyFlip,
  cardRewardFor,
  dealDeck,
  finalizeCards,
  keysFor,
  replay,
  validateCardRun,
} from './core.ts';
import type { CardDifficulty, Flip } from './core.ts';

const DIFFS: CardDifficulty[] = ['easy', 'normal', 'hard'];

/** A player who remembers every card they have seen. `gap` returns the ms before each flip. */
function playMemory(deck: number[], difficulty: CardDifficulty, gap: (n: number) => number): Flip[] {
  const seen = new Map<number, number>(); // face -> first index seen
  const done = new Set<number>();
  const flips: Flip[] = [];
  let t = 0;
  const flip = (i: number) => { t += gap(flips.length); flips.push({ i, t }); };
  const unseen = () => deck.map((_, i) => i).filter((i) => !done.has(i) && ![...seen.values()].includes(i));
  while (done.size < deck.length) {
    // A known pair first, if both halves have been seen.
    const known = deck.map((f, i) => ({ f, i })).filter(({ f, i }) => !done.has(i) && seen.has(f) && seen.get(f) !== i);
    if (known.length) {
      const { f, i } = known[0];
      flip(seen.get(f)!); flip(i);
      done.add(seen.get(f)!); done.add(i);
      continue;
    }
    const a = unseen()[0];
    flip(a);
    const face = deck[a];
    if (seen.has(face) && seen.get(face) !== a) { flip(seen.get(face)!); done.add(a); done.add(seen.get(face)!); continue; }
    seen.set(face, a);
    const b = unseen()[0];
    flip(b);
    if (deck[b] === face) { done.add(a); done.add(b); } else if (seen.has(deck[b]) === false) seen.set(deck[b], b);
  }
  return flips;
}

test('decks are deterministic, correctly sized, and every face appears exactly twice', () => {
  for (const d of DIFFS) {
    const a = dealDeck(12345, d);
    assert.deepEqual(a, dealDeck(12345, d));
    assert.notDeepEqual(a, dealDeck(54321, d));
    const cfg = CARD_CONFIG[d];
    assert.equal(a.length, cfg.cols * cfg.rows);
    assert.equal(a.length, cfg.pairs * 2);
    const counts = new Map<number, number>();
    a.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1));
    assert.equal(counts.size, cfg.pairs);
    assert.ok([...counts.values()].every((c) => c === 2));
  }
});

test('scoring: matches build a streak, mismatches cost points and reset it', () => {
  const deck = dealDeck(7, 'easy');
  const pairOf = (i: number) => deck.findIndex((f, k) => f === deck[i] && k !== i);
  const a = 0, b = pairOf(0);
  const rest = deck.map((_, i) => i).filter((i) => i !== a && i !== b);
  const c = rest[0], d = pairOf(c);
  const wrong1 = rest.find((i) => i !== c && i !== d)!;
  const wrong2 = rest.find((i) => i !== c && i !== d && deck[i] !== deck[wrong1])!;

  let flips: Flip[] = [];
  const f = (i: number) => { const t = (flips.length + 1) * 1000; flips = [...flips, { i, t }]; };
  f(a); f(b); // match 1: 100
  assert.equal(replay(deck, flips, 'easy').score, 100);
  f(c); f(d); // match 2 on a streak of 1: 125
  assert.equal(replay(deck, flips, 'easy').score, 225);
  f(wrong1); f(wrong2); // mismatch: -10, streak reset
  const r = replay(deck, flips, 'easy');
  assert.equal(r.score, 215);
  assert.equal(r.mismatches, 1);
  assert.equal(r.streak, 0);
  assert.equal(r.bestStreak, 2);
});

test('flip rules: bad index, repeat, matched, too fast, time up, already done', () => {
  const deck = dealDeck(7, 'easy');
  const cfg = CARD_CONFIG.easy;
  assert.equal(applyFlip(deck, [], 99, 1000, 'easy').ok, false);
  assert.deepEqual(applyFlip(deck, [], -1, 1000, 'easy'), { ok: false, reason: 'bad_index' });
  const first = applyFlip(deck, [], 0, 1000, 'easy');
  assert.ok(first.ok && first.result === 'first');
  const flips = first.ok ? first.flips : [];
  assert.deepEqual(applyFlip(deck, flips, 0, 2000, 'easy'), { ok: false, reason: 'same_card' });
  assert.deepEqual(applyFlip(deck, flips, 1, 1000 + MIN_FLIP_GAP_MS - 1, 'easy'), { ok: false, reason: 'too_fast' });
  assert.deepEqual(applyFlip(deck, flips, 1, cfg.timeLimitMs + 1, 'easy'), { ok: false, reason: 'time_up' });
  // Matched cards cannot be flipped again.
  const partner = deck.findIndex((f, k) => f === deck[0] && k !== 0);
  const m = applyFlip(deck, flips, partner, 2000, 'easy');
  assert.ok(m.ok && m.result === 'match');
  assert.deepEqual(applyFlip(deck, m.ok ? m.flips : [], 0, 3000, 'easy'), { ok: false, reason: 'already_matched' });
});

test('a memory player clears every difficulty, and the clear bonus rewards speed', () => {
  for (const d of DIFFS) {
    const deck = dealDeck(99, d);
    const fast = playMemory(deck, d, () => 900);
    const slow = playMemory(deck, d, () => 1600);
    const ff = finalizeCards(deck, fast, d);
    const fs = finalizeCards(deck, slow, d);
    assert.ok(ff.cleared && fs.cleared, `${d} cleared`);
    assert.ok(ff.score > fs.score, `${d} faster scores higher`);
    assert.ok(ff.quality > 0.4 && ff.quality <= 1);
  }
});

test('human-paced play is accepted and earns points', () => {
  const deck = dealDeck(21, 'normal');
  const rnd = mulberry32(5);
  const flips = playMemory(deck, 'normal', () => 700 + Math.floor(rnd() * 900));
  const v = validateCardRun(deck, flips, 'normal');
  assert.equal(v.verdict, 'accepted', JSON.stringify(v));
  const r = cardRewardFor(v.final!, 'normal', v.verdict);
  assert.ok(r.xp > 0 && r.coins > 0);
});

test('machine-paced play is flagged and earns no Airdrop Points', () => {
  const deck = dealDeck(21, 'normal');
  const flips = playMemory(deck, 'normal', () => MIN_FLIP_GAP_MS + 10);
  const v = validateCardRun(deck, flips, 'normal');
  assert.equal(v.verdict, 'flagged');
  assert.ok(v.flags.includes('inhuman_speed') && v.flags.includes('uniform_timing'));
  assert.equal(cardRewardFor(v.final!, 'normal', v.verdict).airdropPoints, 0);
});

test('a tampered flip log is rejected', () => {
  const deck = dealDeck(21, 'easy');
  assert.deepEqual(validateCardRun(deck, [{ i: 0, t: 1000 }, { i: 0, t: 2000 }], 'easy').reasons, ['same_card']);
  assert.deepEqual(validateCardRun(deck, [{ i: 0, t: 1000 }, { i: 1, t: 1050 }], 'easy').reasons, ['too_fast']);
  assert.deepEqual(validateCardRun(deck, [{ i: 0, t: 1000 }, { i: 1, t: 999999 }], 'easy').reasons, ['time_up']);
  assert.equal(cardRewardFor(finalizeCards(deck, [], 'easy'), 'easy', 'rejected').xp, 0);
});

test('an abandoned run scores nothing and earns no key rating beyond one', () => {
  const deck = dealDeck(3, 'easy');
  const f = finalizeCards(deck, [], 'easy');
  assert.equal(f.score, 0);
  assert.equal(f.cleared, false);
  assert.equal(keysFor(0.9, false), 1);
  assert.equal(keysFor(0.9, true), 3);
});
