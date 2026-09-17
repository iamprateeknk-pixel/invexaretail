import test from 'node:test';
import assert from 'node:assert/strict';
import { roleMeetsRequirement, findTriggeredRule } from './approval-rules.js';

test('roleMeetsRequirement lets a higher-ranked role satisfy a lower requirement', () => {
  assert.equal(roleMeetsRequirement('ADMIN', 'BRANCH_MANAGER'), true);
  assert.equal(roleMeetsRequirement('BRANCH_MANAGER', 'BRANCH_MANAGER'), true);
  assert.equal(roleMeetsRequirement('STORE_USER', 'BRANCH_MANAGER'), false);
  assert.equal(roleMeetsRequirement('BRANCH_MANAGER', 'ADMIN'), false);
});

test('findTriggeredRule requires the threshold to actually be crossed', () => {
  const rule = { id: 'r1', category: null, branchId: null, valueThreshold: 100000, requiredApproverRole: 'BRANCH_MANAGER' };
  assert.equal(findTriggeredRule([rule], { category: null, branchId: null, value: 100000 })?.id, 'r1');
  assert.equal(findTriggeredRule([rule], { category: null, branchId: null, value: 99999 }), null);
});

test('findTriggeredRule prefers a branch-specific rule over a global one', () => {
  const global = { id: 'global', category: null, branchId: null, valueThreshold: 100000, requiredApproverRole: 'BRANCH_MANAGER' };
  const branchSpecific = { id: 'branch', category: null, branchId: 'branch-1', valueThreshold: 100000, requiredApproverRole: 'ADMIN' };
  const matched = findTriggeredRule([global, branchSpecific], { category: null, branchId: 'branch-1', value: 150000 });
  assert.equal(matched?.id, 'branch');
});

test('findTriggeredRule ignores a branch-scoped rule for a different branch', () => {
  const branchSpecific = { id: 'branch', category: null, branchId: 'branch-1', valueThreshold: 100000, requiredApproverRole: 'ADMIN' };
  assert.equal(findTriggeredRule([branchSpecific], { category: null, branchId: 'branch-2', value: 150000 }), null);
});

test('findTriggeredRule ignores a category-scoped rule for a different category', () => {
  const categorySpecific = { id: 'electronics', category: 'Electronics', branchId: null, valueThreshold: 50000, requiredApproverRole: 'ADMIN' };
  assert.equal(findTriggeredRule([categorySpecific], { category: 'Dairy', branchId: null, value: 60000 }), null);
  assert.equal(findTriggeredRule([categorySpecific], { category: 'Electronics', branchId: null, value: 60000 })?.id, 'electronics');
});

test('findTriggeredRule prefers a category+branch rule over a category-only or global one', () => {
  const global = { id: 'global', category: null, branchId: null, valueThreshold: 10000, requiredApproverRole: 'BRANCH_MANAGER' };
  const categoryOnly = { id: 'category', category: 'Electronics', branchId: null, valueThreshold: 10000, requiredApproverRole: 'BRANCH_MANAGER' };
  const both = { id: 'both', category: 'Electronics', branchId: 'branch-1', valueThreshold: 10000, requiredApproverRole: 'ADMIN' };
  const matched = findTriggeredRule([global, categoryOnly, both], { category: 'Electronics', branchId: 'branch-1', value: 20000 });
  assert.equal(matched?.id, 'both');
});
