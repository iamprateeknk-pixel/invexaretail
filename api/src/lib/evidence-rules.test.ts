import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleTriggers, findTriggeredEvidenceRule } from './evidence-rules.js';

test('ruleTriggers matches scope and either independent threshold', () => {
  const quantityRule = { id: 'q1', label: 'Qty', category: null, branchId: null, quantityThreshold: 5, valueThreshold: null };
  assert.equal(ruleTriggers(quantityRule, { category: null, branchId: null, quantity: 5, value: 0 }), true);
  assert.equal(ruleTriggers(quantityRule, { category: null, branchId: null, quantity: 4, value: 999999 }), false);

  const valueRule = { id: 'v1', label: 'Value', category: null, branchId: null, quantityThreshold: null, valueThreshold: 10000 };
  assert.equal(ruleTriggers(valueRule, { category: null, branchId: null, quantity: 0, value: 10000 }), true);
  assert.equal(ruleTriggers(valueRule, { category: null, branchId: null, quantity: 999, value: 9999 }), false);
});

test('ruleTriggers ignores a category-scoped rule for a different category', () => {
  const rule = { id: 'e1', label: 'Electronics', category: 'Electronics', branchId: null, quantityThreshold: 1, valueThreshold: null };
  assert.equal(ruleTriggers(rule, { category: 'Dairy', branchId: null, quantity: 5, value: 0 }), false);
  assert.equal(ruleTriggers(rule, { category: 'Electronics', branchId: null, quantity: 5, value: 0 }), true);
});

test('ruleTriggers ignores a branch-scoped rule for a different branch', () => {
  const rule = { id: 'b1', label: 'Branch', category: null, branchId: 'branch-1', quantityThreshold: 1, valueThreshold: null };
  assert.equal(ruleTriggers(rule, { category: null, branchId: 'branch-2', quantity: 5, value: 0 }), false);
  assert.equal(ruleTriggers(rule, { category: null, branchId: 'branch-1', quantity: 5, value: 0 }), true);
});

test('findTriggeredEvidenceRule prefers the most specific matching, triggered rule', () => {
  const global = { id: 'global', label: 'Global', category: null, branchId: null, quantityThreshold: 1, valueThreshold: null };
  const categoryOnly = { id: 'category', label: 'Category', category: 'Electronics', branchId: null, quantityThreshold: 1, valueThreshold: null };
  const both = { id: 'both', label: 'Both', category: 'Electronics', branchId: 'branch-1', quantityThreshold: 1, valueThreshold: null };
  const matched = findTriggeredEvidenceRule([global, categoryOnly, both], { category: 'Electronics', branchId: 'branch-1', quantity: 5, value: 0 });
  assert.equal(matched?.id, 'both');
});

test('findTriggeredEvidenceRule returns null when nothing triggers', () => {
  const rule = { id: 'r1', label: 'R', category: null, branchId: null, quantityThreshold: 100, valueThreshold: null };
  assert.equal(findTriggeredEvidenceRule([rule], { category: null, branchId: null, quantity: 1, value: 0 }), null);
});
