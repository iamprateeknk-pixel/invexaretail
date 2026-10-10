import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionToOutcome, conditionToRows, describeAutomation, describeRule, describeRuleResult, describeWorkflow, diffEntries,
  modelToWorkflow, outcomeToAction, rowsToCondition, slugKey, workflowToModel,
} from './studio-catalog.js';

test('slugKey turns a name into a unique technical key', () => {
  assert.equal(slugKey('Shelf No.'), 'shelf_no');
  assert.equal(slugKey('Shelf No.', ['shelf_no']), 'shelf_no_2');
  assert.equal(slugKey('12 Pack'), 'f_12_pack');
  assert.equal(slugKey('  '), 'field');
});

test('rule conditions round-trip between the server shape and plain rows', () => {
  const condition = { branchCity: 'Jaipur', adjustmentValueGt: 10000, daysToExpiryLte: 7 };
  const rows = conditionToRows(condition);
  assert.deepEqual(rows, [
    { field: 'branchCity', op: 'eq', value: 'Jaipur' },
    { field: 'adjustmentValue', op: 'Gt', value: '10000' },
    { field: 'daysToExpiry', op: 'Lte', value: '7' },
  ]);
  assert.deepEqual(rowsToCondition(rows), condition);
  assert.equal(describeRule({ condition, outcome: { requireApproval: 'BRANCH_MANAGER' } }),
    'When Branch city is Jaipur and Stock adjustment value (₹) is more than 10000 and Days left to expiry is at most 7 → Ask a branch manager to approve');
});

test('outcomes keep the approval shape the evaluator already understands', () => {
  assert.equal(outcomeToAction({ requireApproval: 'ADMIN' }), 'REQUIRE_APPROVAL:ADMIN');
  assert.deepEqual(actionToOutcome('REQUIRE_APPROVAL:ADMIN'), { requireApproval: 'ADMIN' });
  assert.deepEqual(actionToOutcome('SEND_NOTIFICATION'), { action: 'SEND_NOTIFICATION' });
  assert.equal(describeRuleResult('BRANCH_MANAGER'), 'Ask a branch manager to approve');
  assert.equal(describeRuleResult('CREATE_TASK:EXPIRY_ACTION'), 'Create an expiry task');
});

test('approval workflows round-trip through the plain model', () => {
  const seeded = {
    key: 'transfer.approval', name: 'Transfer approval', version: 1,
    graph: { nodes: [
      { id: 'start', type: 'trigger', config: { event: 'transfer.created' } },
      { id: 'check', type: 'condition', config: { field: 'value', op: 'lte', amount: 100000 } },
      { id: 'auto', type: 'action', config: { action: 'AUTO_APPROVE' } },
      { id: 'manager', type: 'approval', config: { role: 'BRANCH_MANAGER' } },
    ] },
  };
  const model = workflowToModel(seeded);
  assert.deepEqual(model, { key: 'transfer.approval', name: 'Transfer approval', version: 1, target: 'transfer', threshold: '100000', approverRole: 'BRANCH_MANAGER' });
  assert.deepEqual(modelToWorkflow(model), seeded);
  assert.match(describeWorkflow(model), /^Transfers up to ₹1,00,000 are approved automatically; above that a branch manager must approve\.$/);
});

test('automations read as a sentence', () => {
  assert.equal(describeAutomation({ trigger: 'event', expression: 'inventory.low_stock', actionKey: 'SEND_NOTIFICATION' }), 'When stock falls low → Send a notification');
  assert.equal(describeAutomation({ trigger: 'schedule', expression: 'daily@09:00', actionKey: 'SEND_EMAIL' }), 'Every day at 9 am → Email the admins');
});

test('diffEntries sends only new or changed entries and the removed ids', () => {
  const saved = [{ key: 'a', n: 1 }, { key: 'b', n: 1 }, { key: 'c', n: 1 }];
  const edited = [{ key: 'a', n: 1 }, { key: 'b', n: 2 }, { key: 'd', n: 1 }];
  const { upserts, removals } = diffEntries(saved, edited, (entry) => entry.key);
  assert.deepEqual(upserts.map((entry) => entry.key), ['b', 'd']);
  assert.deepEqual(removals, ['c']);
});
