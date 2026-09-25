import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCountReasonCode, summarizeVarianceReasons } from './count-reason-codes.js';

test('reason codes are optional but must be a known code when given', () => {
  assert.equal(parseCountReasonCode(undefined), undefined);
  assert.equal(parseCountReasonCode(' damage '), 'DAMAGE');
  assert.throws(() => parseCountReasonCode('lost'), /reasonCode must be one of/);
});

test('variances are grouped by root cause, uncoded ones are visible, exact matches ignored', () => {
  const rows = summarizeVarianceReasons([
    { physicalQty: 8, bookQty: 10, reasonCode: 'DAMAGE' },
    { physicalQty: 5, bookQty: 10, reasonCode: 'DAMAGE' },
    { physicalQty: 12, bookQty: 10 },
    { physicalQty: 10, bookQty: 10, reasonCode: 'MISCOUNT' },
  ]);
  assert.deepEqual(rows, [
    { reasonCode: 'DAMAGE', counts: 2, absoluteUnits: 7, netUnits: -7 },
    { reasonCode: 'UNCODED', counts: 1, absoluteUnits: 2, netUnits: 2 },
  ]);
});
