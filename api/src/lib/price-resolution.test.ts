import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrice, type PriceCandidate } from './price-resolution.js';

function row(overrides: Partial<PriceCandidate>): PriceCandidate {
  return {
    id: overrides.id ?? 'p1',
    price: overrides.price ?? 100,
    branchId: overrides.branchId ?? null,
    customerGroup: overrides.customerGroup ?? null,
    effectiveFrom: overrides.effectiveFrom ?? '2026-01-01T00:00:00.000Z',
    effectiveTo: overrides.effectiveTo ?? null,
    status: overrides.status ?? 'ACTIVE',
  };
}

test('a company-wide price applies when nothing more specific exists', () => {
  const result = resolvePrice([row({ price: 100 })], {});
  assert.equal(result?.price, 100);
});

test('a branch-specific price wins over the company-wide price at that branch', () => {
  const candidates = [row({ id: 'wide', price: 100 }), row({ id: 'branch', price: 90, branchId: 'jaipur' })];
  const result = resolvePrice(candidates, { branchId: 'jaipur' });
  assert.equal(result?.id, 'branch');
});

test('a branch-specific price never applies to a different branch', () => {
  const candidates = [row({ id: 'wide', price: 100 }), row({ id: 'branch', price: 90, branchId: 'jaipur' })];
  const result = resolvePrice(candidates, { branchId: 'basni' });
  assert.equal(result?.id, 'wide');
});

test('branch + customer-group match beats either alone', () => {
  const candidates = [
    row({ id: 'wide', price: 100 }),
    row({ id: 'branch', price: 90, branchId: 'jaipur' }),
    row({ id: 'group', price: 85, customerGroup: 'wholesale' }),
    row({ id: 'both', price: 80, branchId: 'jaipur', customerGroup: 'wholesale' }),
  ];
  const result = resolvePrice(candidates, { branchId: 'jaipur', customerGroup: 'wholesale' });
  assert.equal(result?.id, 'both');
});

test('a price outside its effective date range is ignored', () => {
  const candidates = [
    row({ id: 'expired', price: 50, effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: '2020-06-01T00:00:00.000Z' }),
    row({ id: 'current', price: 100 }),
  ];
  const result = resolvePrice(candidates, { at: '2026-06-01T00:00:00.000Z' });
  assert.equal(result?.id, 'current');
});

test('a future-dated price does not apply yet', () => {
  const candidates = [row({ id: 'future', price: 999, effectiveFrom: '2099-01-01T00:00:00.000Z' })];
  const result = resolvePrice(candidates, { at: '2026-06-01T00:00:00.000Z' });
  assert.equal(result, null);
});

test('an INACTIVE row is never resolved', () => {
  const result = resolvePrice([row({ status: 'INACTIVE' })], {});
  assert.equal(result, null);
});

test('between two currently-effective rows of equal specificity, the more recently effective one wins', () => {
  const candidates = [
    row({ id: 'old', price: 100, effectiveFrom: '2026-01-01T00:00:00.000Z' }),
    row({ id: 'new', price: 110, effectiveFrom: '2026-03-01T00:00:00.000Z' }),
  ];
  const result = resolvePrice(candidates, { at: '2026-06-01T00:00:00.000Z' });
  assert.equal(result?.id, 'new');
});

test('no candidates at all resolves to null, not a thrown error', () => {
  assert.equal(resolvePrice([], {}), null);
});
