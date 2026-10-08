import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getIndustryPack,
  missingPackSeeds,
  resolveIndustryKey,
  toWorkspacePackView,
  workflowFromPack,
} from './industry-packs.js';

test('resolveIndustryKey always returns grocery for this deployment', () => {
  assert.equal(resolveIndustryKey('pharmacy'), 'grocery');
  assert.equal(resolveIndustryKey('electronics'), 'grocery');
  assert.equal(resolveIndustryKey('supermarket'), 'grocery');
  assert.equal(resolveIndustryKey(''), 'grocery');
});

test('missingPackSeeds is idempotent by case-insensitive name', () => {
  const created = missingPackSeeds(['Fresh', 'chilled'], [
    { name: 'Fresh' },
    { name: 'Frozen' },
    { name: 'CHILLED' },
  ]);
  assert.deepEqual(created.map((row) => row.name), ['Frozen']);
});

test('grocery pack matches Invexa item/lot model: FEFO, expiry, seed categories', () => {
  const pack = getIndustryPack();
  const view = toWorkspacePackView(pack);
  const workflow = workflowFromPack(pack);
  assert.equal(pack.key, 'grocery');
  assert.equal(view.modules.expiry, true);
  assert.equal(view.modules.assets, false);
  assert.ok(pack.categories.includes('Staples'));
  assert.ok(pack.categories.includes('Dairy'));
  assert.ok(pack.categories.includes('Household'));
  assert.ok(pack.units.includes('bag'));
  assert.equal(workflow.allocationStrategy, 'FEFO');
  assert.equal(workflow.expiryBlocking, true);
});

test('the active workflow is per company: changing one company leaves every other company untouched', async () => {
  const { getActiveWorkflow, setActiveWorkflow } = await import('./industry-packs.js');
  const defaultBefore = getActiveWorkflow();
  const neutralBefore = getActiveWorkflow('company-never-configured');
  setActiveWorkflow({ allocationStrategy: 'FIFO', expiryBlocking: false, fefoEnforced: false, industryKey: 'grocery' }, 'company-b');
  assert.equal(getActiveWorkflow('company-b').allocationStrategy, 'FIFO');
  assert.deepEqual(getActiveWorkflow(), defaultBefore, "the default company's workflow did not move");
  assert.deepEqual(getActiveWorkflow('company-never-configured'), neutralBefore, 'an unconfigured company is not given company B\'s workflow');
  // Restore: the default company's workflow is also what an absent argument means.
  setActiveWorkflow(defaultBefore);
  assert.deepEqual(getActiveWorkflow(), defaultBefore);
});
