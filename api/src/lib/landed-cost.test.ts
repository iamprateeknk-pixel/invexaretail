import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateLandedCost } from './landed-cost.js';

test('with no extra charges, landed cost equals base unit cost', () => {
  const result = allocateLandedCost(
    [{ itemId: 'a', quantity: 10, unitCost: 100 }],
    {},
  );
  assert.equal(result[0].allocatedCharge, 0);
  assert.equal(result[0].landedUnitCost, 100);
});

test('VALUE method splits charges proportional to line value, total allocation equals total charges', () => {
  const result = allocateLandedCost(
    [
      { itemId: 'cheap', quantity: 10, unitCost: 10 }, // value 100
      { itemId: 'expensive', quantity: 10, unitCost: 90 }, // value 900
    ],
    { freight: 100, customs: 0, insurance: 0, handling: 0 },
    'VALUE',
  );
  const totalAllocated = result.reduce((sum, row) => sum + row.allocatedCharge, 0);
  assert.ok(Math.abs(totalAllocated - 100) < 1e-9);
  // expensive line is 9x the value of cheap, so it should absorb 9x the charge
  assert.ok(Math.abs(result[1].allocatedCharge - result[0].allocatedCharge * 9) < 1e-6);
});

test('QUANTITY method splits charges evenly per unit regardless of price', () => {
  const result = allocateLandedCost(
    [
      { itemId: 'a', quantity: 10, unitCost: 1000 },
      { itemId: 'b', quantity: 10, unitCost: 1 },
    ],
    { freight: 200 },
    'QUANTITY',
  );
  assert.equal(result[0].allocatedCharge, result[1].allocatedCharge);
});

test('WEIGHT method splits charges proportional to total weight', () => {
  const result = allocateLandedCost(
    [
      { itemId: 'light', quantity: 1, unitCost: 100, weightKg: 1 },
      { itemId: 'heavy', quantity: 1, unitCost: 100, weightKg: 9 },
    ],
    { freight: 100 },
    'WEIGHT',
  );
  assert.ok(Math.abs(result[1].allocatedCharge - result[0].allocatedCharge * 9) < 1e-6);
});

test('WEIGHT method falls back to value share for a line with no weight recorded', () => {
  const result = allocateLandedCost(
    [
      { itemId: 'has-weight', quantity: 1, unitCost: 100, weightKg: 5 },
      { itemId: 'no-weight', quantity: 1, unitCost: 100 },
    ],
    { freight: 100 },
    'WEIGHT',
  );
  const totalAllocated = result.reduce((sum, row) => sum + row.allocatedCharge, 0);
  assert.ok(Math.abs(totalAllocated - 100) < 1e-9);
  assert.ok(result[1].allocatedCharge > 0, 'a line missing weight must still get a share, not be zeroed out');
});

test('multiple charge types (freight+customs+insurance+handling) sum before allocating', () => {
  const result = allocateLandedCost(
    [{ itemId: 'a', quantity: 5, unitCost: 20 }],
    { freight: 10, customs: 5, insurance: 3, handling: 2 },
    'VALUE',
  );
  assert.equal(result[0].allocatedCharge, 20);
  assert.equal(result[0].landedUnitCost, 24);
});
