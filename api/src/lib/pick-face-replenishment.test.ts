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

// Audit R-2: replenishment must be FEFO-aware.
test('the earliest-expiry reserve lot is moved first, even if a fresher bin holds more', () => {
  const suggestion = planPickFaceReplenishment(
    { binId: 'pf', code: 'PF-1', onHand: 1, min: 5, max: 10 },
    [
      { binId: 'r1', code: 'R-1', onHand: 100, lotId: 'fresh', expiryDate: '2027-06-01T00:00:00Z' },
      { binId: 'r2', code: 'R-2', onHand: 6, lotId: 'old', expiryDate: '2026-11-01T00:00:00Z' },
    ],
  );
  assert.equal(suggestion?.fromBinCode, 'R-2');
  assert.equal(suggestion?.lotId, 'old');
  assert.equal(suggestion?.quantity, 6);
});

test('undated lots sort after dated ones; among equals the richest bin wins', () => {
  const s = planPickFaceReplenishment({ binId: 'pf', code: 'PF', onHand: 0, min: 5, max: 8 }, [
    { binId: 'a', code: 'A', onHand: 3 },
    { binId: 'b', code: 'B', onHand: 9 },
    { binId: 'c', code: 'C', onHand: 2, expiryDate: '2026-12-01T00:00:00Z' },
  ]);
  assert.equal(s?.fromBinCode, 'C');
  const rich = planPickFaceReplenishment({ binId: 'pf', code: 'PF', onHand: 0, min: 5, max: 8 }, [
    { binId: 'a', code: 'A', onHand: 3 }, { binId: 'b', code: 'B', onHand: 9 },
  ]);
  assert.equal(rich?.fromBinCode, 'B');
});
