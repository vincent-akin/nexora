import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStamina } from './stamina.ts';

const rules = { stamina_cap: 10, stamina_refill_seconds: 1200 };
const at = (iso: string) => new Date(iso);

test('stamina refills one point per interval and keeps the remainder', () => {
  const row = { stamina: 3, updated_at: '2026-10-11T10:00:00Z' };
  assert.deepEqual(currentStamina(row, rules, at('2026-10-11T10:00:00Z')), { value: 3, secondsToNext: 1200 });
  assert.deepEqual(currentStamina(row, rules, at('2026-10-11T10:25:00Z')), { value: 4, secondsToNext: 900 });
  assert.equal(currentStamina(row, rules, at('2026-10-11T11:00:00Z')).value, 6);
});

test('stamina never exceeds the cap', () => {
  const row = { stamina: 9, updated_at: '2026-10-11T10:00:00Z' };
  assert.deepEqual(currentStamina(row, rules, at('2026-10-12T10:00:00Z')), { value: 10, secondsToNext: 0 });
});
