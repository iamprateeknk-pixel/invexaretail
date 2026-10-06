import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionTarget, buildAttentionList, onboardingSteps, onboardingProgress } from './attention.js';

test('attention list drops zero cards and orders by urgency', () => {
  const list = buildAttentionList([
    { label: 'Pending counts', value: 3 },
    { label: 'Low stock', value: 0 },
    { label: 'Open exceptions', value: 2 },
    { label: 'Unknown card', value: 9 },
  ]);
  assert.deepEqual(list.map((c) => c.label), ['Open exceptions', 'Pending counts']);
});

test('attention list respects the limit', () => {
  const cards = ['Open exceptions', 'Expiry risk', 'Low stock'].map((label) => ({ label, value: 1 }));
  assert.equal(buildAttentionList(cards, 2).length, 2);
});

test('onboarding progress reflects completed steps', () => {
  const steps = onboardingSteps({ locationCount: 1, itemCount: 5 });
  assert.deepEqual(onboardingProgress(steps), { done: 2, total: 4, complete: false });
  assert.equal(onboardingProgress(onboardingSteps({ locationCount: 1, itemCount: 1, hasStock: true, hasMovement: true })).complete, true);
});

test('low stock sends admins to the purchase plan and others to stock', () => {
  const card = { label: 'Low stock', section: 'inventory' };
  assert.equal(attentionTarget(card, 'ADMIN'), 'purchase-orders');
  assert.equal(attentionTarget(card, 'STORE_USER'), 'inventory');
  assert.equal(attentionTarget({ label: 'Open exceptions', section: 'exceptions' }, 'ADMIN'), 'exceptions');
});
