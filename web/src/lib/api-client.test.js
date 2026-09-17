import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOfflineAction } from './offline-action.js';

test('offline mutations are classified for the correct sync queue', () => {
  assert.equal(classifyOfflineAction('/api/v1/counts'), 'count');
  assert.equal(classifyOfflineAction('/api/v1/transfers/tr-1/receive'), 'receive');
  assert.equal(classifyOfflineAction('/api/v1/count-assignments'), 'assignment');
  assert.equal(classifyOfflineAction('/api/v1/imports/opening-stock'), 'import');
  assert.equal(classifyOfflineAction('/api/v1/putaway-tasks/t1/confirm'), 'putaway');
  assert.equal(classifyOfflineAction('/api/v1/picker/transfers/t1/pick-slips'), 'pick');
  assert.equal(classifyOfflineAction('/api/v1/exceptions'), 'exception');
  assert.equal(classifyOfflineAction('/api/v1/qc-inspections'), 'qc');
});
