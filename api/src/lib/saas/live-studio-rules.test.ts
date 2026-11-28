import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingLiveStudioRules, publishedLiveStudioRules, ruleConditionMatches, validateLiveStudioRule } from './live-studio-rules.js';
import type { RuleDefinition } from './control-plane.js';

const cap: RuleDefinition = {
  key: 'cap', name: 'Adjustment cap', liveFor: 'STOCK_ADJUSTMENT', condition: { adjustmentValueGt: 500 }, outcome: { action: 'BLOCK' },
};

test('only matching live rules apply at publish-time boundaries', () => {
  const payload = { rules: [cap, { ...cap, key: 'simulation', liveFor: undefined }] };
  assert.deepEqual(publishedLiveStudioRules(payload, 'TRANSFER_CONFIRM'), []);
  const rules = publishedLiveStudioRules(payload, 'STOCK_ADJUSTMENT');
  assert.deepEqual(matchingLiveStudioRules(rules, 'STOCK_ADJUSTMENT', 500), []);
  assert.deepEqual(matchingLiveStudioRules(rules, 'STOCK_ADJUSTMENT', 501), [cap]);
});

test('unsupported conditions and outcomes stay simulation-only', () => {
  assert.throws(() => validateLiveStudioRule({ ...cap, condition: { daysToExpiryLt: 2 } }), /numeric values/);
  assert.throws(() => validateLiveStudioRule({ ...cap, outcome: { action: 'SEND_NOTIFICATION' } }), /Live rules can stop/);
  assert.equal(ruleConditionMatches({ adjustmentValueLt: 25 }, { adjustmentValue: null }), false);
});

test('an opted-in expiry rule evaluates calendar days and only creates an expiry task', () => {
  const expiry: RuleDefinition = { key: 'expiry', name: 'Expiry task', liveFor: 'EXPIRY_SWEEP', condition: { daysToExpiryLt: 5 }, outcome: { action: 'CREATE_TASK:EXPIRY_ACTION' } };
  validateLiveStudioRule(expiry);
  assert.deepEqual(matchingLiveStudioRules([expiry], 'EXPIRY_SWEEP', 5), []);
  assert.deepEqual(matchingLiveStudioRules([expiry], 'EXPIRY_SWEEP', 4), [expiry]);
  assert.throws(() => validateLiveStudioRule({ ...expiry, outcome: { action: 'BLOCK' } }), /expiry task/i);
});
