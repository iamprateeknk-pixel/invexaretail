import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleTriggers, evaluateTolerance, type ToleranceRuleLike } from './count-tolerance.js';

function rule(overrides: Partial<ToleranceRuleLike>): ToleranceRuleLike {
  return { id: 'r1', label: 'Rule', category: null, branchId: null, valueThreshold: null, percentThreshold: null, ...overrides };
}

test('ruleTriggers requires both scope match and a crossed threshold', () => {
  const r = rule({ category: 'Dairy', valueThreshold: 5000 });
  assert.equal(ruleTriggers(r, { category: 'Dairy', branchId: null, variancePercent: 0, varianceValue: 6000 }), true);
  assert.equal(ruleTriggers(r, { category: 'Bakery', branchId: null, variancePercent: 0, varianceValue: 6000 }), false, 'category mismatch');
  assert.equal(ruleTriggers(r, { category: 'Dairy', branchId: null, variancePercent: 0, varianceValue: 4000 }), false, 'below threshold');
});

test('ruleTriggers treats a null category/branch on the rule as applying to everything', () => {
  const r = rule({ percentThreshold: 2 });
  assert.equal(ruleTriggers(r, { category: 'Anything', branchId: 'branch-1', variancePercent: 3, varianceValue: 0 }), true);
});

test('evaluateTolerance prefers the most specific matching rule', () => {
  const global = rule({ id: 'global', valueThreshold: 1000 });
  const categoryOnly = rule({ id: 'category', category: 'Dairy', valueThreshold: 1000 });
  const categoryAndBranch = rule({ id: 'both', category: 'Dairy', branchId: 'branch-1', valueThreshold: 1000 });
  const matched = evaluateTolerance([global, categoryOnly, categoryAndBranch], { category: 'Dairy', branchId: 'branch-1', variancePercent: 0, varianceValue: 2000 });
  assert.equal(matched?.id, 'both');
});

test('evaluateTolerance returns null when nothing triggers', () => {
  const r = rule({ valueThreshold: 100000 });
  assert.equal(evaluateTolerance([r], { category: null, branchId: null, variancePercent: 1, varianceValue: 50 }), null);
});
