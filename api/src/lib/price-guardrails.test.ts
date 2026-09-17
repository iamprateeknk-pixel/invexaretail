import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrice } from './price-guardrails.js';

test('a price within MRP, above cost and above minimum margin is ok', () => {
  const result = validatePrice({ proposedPrice: 150, mrp: 200, landedCost: 100, minMarginPercent: 20 });
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
});

test('a price above MRP is blocked', () => {
  const result = validatePrice({ proposedPrice: 250, mrp: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].code, 'ABOVE_MRP');
  assert.equal(result.violations[0].severity, 'BLOCK');
});

test('a price below landed cost is blocked - never publish a guaranteed loss', () => {
  const result = validatePrice({ proposedPrice: 80, landedCost: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].code, 'BELOW_COST');
});

test('a price above cost but below minimum margin is a warning, not a block', () => {
  const result = validatePrice({ proposedPrice: 105, landedCost: 100, minMarginPercent: 20 });
  assert.equal(result.ok, true, 'a WARN-only violation must not flip ok to false');
  assert.equal(result.violations[0].code, 'BELOW_MIN_MARGIN');
  assert.equal(result.violations[0].severity, 'WARN');
});

test('margin percent is computed and returned even when it clears the minimum', () => {
  const result = validatePrice({ proposedPrice: 200, landedCost: 100, minMarginPercent: 20 });
  assert.equal(result.marginPercent, 50);
  assert.equal(result.violations.length, 0);
});

test('an effective end date on or before the start date is blocked', () => {
  const result = validatePrice({
    proposedPrice: 100,
    effectiveFrom: '2026-09-20T00:00:00.000Z',
    effectiveTo: '2026-09-10T00:00:00.000Z',
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].code, 'INVALID_EFFECTIVE_DATE');
});

test('no cost/MRP/margin inputs at all means nothing to violate', () => {
  const result = validatePrice({ proposedPrice: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.marginPercent, null);
});

test('multiple violations are all reported together, not just the first', () => {
  const result = validatePrice({ proposedPrice: 250, mrp: 200, landedCost: 260 });
  const codes = result.violations.map((violation) => violation.code).sort();
  assert.deepEqual(codes, ['ABOVE_MRP', 'BELOW_COST']);
});
