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

test('accuracy is tolerance-based and value-weighted, and uncosted counts are left out of the money figures', async () => {
  const { summarizeCountAccuracy } = await import('./count-reason-codes.js');
  const tol = { minUnits: 3, percent: 10 };
  const r = summarizeCountAccuracy([
    { physicalQty: 100, bookQty: 100, unitCost: 10 },   // exact
    { physicalQty: 96, bookQty: 100, unitCost: 10 },    // 4 off, inside 10% of 100
    { physicalQty: 5, bookQty: 20, unitCost: 100 },     // 15 off, outside
    { physicalQty: 1, bookQty: 2 },                     // 1 off (inside min 3), uncosted
  ], tol);
  assert.equal(r.withinTolerance, 3);
  assert.equal(r.accuracyPercent, 75);
  assert.equal(r.varianceValue, 1540); // 4x10 + 15x100
  assert.equal(r.costedCounts, 3);
  assert.equal(r.valueAccuracyPercent, 61.5); // book = 1000 + 1000 + 2000 = 4000 -> 100 - 1540/4000
});
