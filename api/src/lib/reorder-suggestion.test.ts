import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestReorderRule } from './reorder-suggestion.js';

const steady = Array.from({ length: 30 }, () => 10);

test('steady demand gives min = demand x lead time and a target one cover period higher', () => {
  const s = suggestReorderRule({ itemId: 'a', dailyDemand: steady, leadTimeDays: 5, coverDays: 7 })!;
  assert.equal(s.suggestedMin, 50);
  assert.equal(s.suggestedTarget, 120);
  assert.equal(s.change, 'NEW');
});

test('no demand history yields no suggestion instead of a zero rule', () => {
  assert.equal(suggestReorderRule({ itemId: 'a', dailyDemand: [0, 0, 0], leadTimeDays: 5 }), null);
});

test('variable demand adds safety stock and an existing rule far below target is flagged INCREASE', () => {
  const noisy = Array.from({ length: 30 }, (_, i) => (i % 2 ? 2 : 18));
  const s = suggestReorderRule({ itemId: 'a', dailyDemand: noisy, leadTimeDays: 5, currentMin: 10, currentTarget: 20 })!;
  assert.ok(s.safetyStock > 0);
  assert.equal(s.change, 'INCREASE');
  assert.equal(suggestReorderRule({ itemId: 'a', dailyDemand: steady, leadTimeDays: 5, coverDays: 7, currentMin: 50, currentTarget: 120 })!.change, 'OK');
});

test('decimal items keep fractions, counted items round up', () => {
  const d = Array.from({ length: 30 }, () => 0.35);
  assert.equal(suggestReorderRule({ itemId: 'a', dailyDemand: d, leadTimeDays: 3, decimal: false })!.suggestedMin, 2);
  assert.equal(suggestReorderRule({ itemId: 'a', dailyDemand: d, leadTimeDays: 3, decimal: true })!.suggestedMin, 1.05);
});
