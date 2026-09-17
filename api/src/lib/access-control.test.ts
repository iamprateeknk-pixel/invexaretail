import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPermission } from './access-control.js';

test('classifies critical API operations', () => {
  assert.deepEqual(classifyPermission('POST', '/imports/batch/reverse'), { module: 'IMPORT', action: 'REVERSE' });
  assert.deepEqual(classifyPermission('PATCH', '/stock-counts/1/review'), { module: 'COUNT', action: 'APPROVE' });
  assert.deepEqual(classifyPermission('GET', '/export/stock'), { module: 'REPORT', action: 'EXPORT' });
  assert.deepEqual(classifyPermission('DELETE', '/locations/1'), { module: 'ADMIN', action: 'DELETE' });
  assert.deepEqual(classifyPermission('POST', '/transfers'), { module: 'TRANSFER', action: 'CREATE' });
});
