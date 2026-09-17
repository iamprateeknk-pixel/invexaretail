import test from 'node:test';
import assert from 'node:assert/strict';
import { planPickFaceReplenishment } from './pick-face-replenishment.js';

test('a pick-face bin at or above its min needs nothing', () => {
  const result = planPickFaceReplenishment(
    { binId: 'pf-1', code: 'A-01-PF', onHand: 5, min: 5, max: 20 },
    [{ binId: 'rv-1', code: 'A-99-RES', onHand: 100 }],
  );
  assert.equal(result, null);
});

test('tops up to max from the richest reserve bin', () => {
  const result = planPickFaceReplenishment(
    { binId: 'pf-1', code: 'A-01-PF', onHand: 2, min: 5, max: 20 },
    [
      { binId: 'rv-1', code: 'A-99-RES', onHand: 10 },
      { binId: 'rv-2', code: 'A-98-RES', onHand: 50 },
    ],
  );
  assert.deepEqual(result, {
    fromBinId: 'rv-2', fromBinCode: 'A-98-RES',
    toBinId: 'pf-1', toBinCode: 'A-01-PF',
    quantity: 18,
  });
});

test('caps the suggested quantity to what the richest reserve bin actually has', () => {
  const result = planPickFaceReplenishment(
    { binId: 'pf-1', code: 'A-01-PF', onHand: 0, min: 5, max: 20 },
    [{ binId: 'rv-1', code: 'A-99-RES', onHand: 7 }],
  );
  assert.deepEqual(result, {
    fromBinId: 'rv-1', fromBinCode: 'A-99-RES',
    toBinId: 'pf-1', toBinCode: 'A-01-PF',
    quantity: 7,
  });
});

test('suggests nothing when no reserve bin has stock', () => {
  const result = planPickFaceReplenishment(
    { binId: 'pf-1', code: 'A-01-PF', onHand: 1, min: 5, max: 20 },
    [{ binId: 'rv-1', code: 'A-99-RES', onHand: 0 }],
  );
  assert.equal(result, null);
});
