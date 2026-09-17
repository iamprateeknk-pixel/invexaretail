import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVendorScore, computePriceVariance } from './vendor-score.js';

test('no orders yields a zeroed score, not a crash', () => {
  const result = computeVendorScore([]);
  assert.equal(result.ordersConsidered, 0);
  assert.equal(result.fillRatePercent, 0);
  assert.equal(result.averageLeadTimeDays, null);
});

test('fill rate is total received over total ordered across all orders', () => {
  const result = computeVendorScore([
    { quantity: 100, receivedQty: 100, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
    { quantity: 100, receivedQty: 50, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(result.fillRatePercent, 75);
});

test('an over-receipt does not inflate fill rate above 100%, and is flagged as excess', () => {
  const result = computeVendorScore([
    { quantity: 100, receivedQty: 120, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(result.fillRatePercent, 100);
  assert.equal(result.excessReceiptCount, 1);
  assert.equal(result.shortReceiptCount, 0);
});

test('a short receipt is flagged separately from an excess one', () => {
  const result = computeVendorScore([
    { quantity: 100, receivedQty: 80, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(result.shortReceiptCount, 1);
  assert.equal(result.excessReceiptCount, 0);
});

test('on-time delivery only counts orders with both an expected and an actual completion date', () => {
  const result = computeVendorScore([
    { quantity: 10, receivedQty: 10, expectedAt: '2026-01-10T00:00:00.000Z', completedAt: '2026-01-09T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }, // on time
    { quantity: 10, receivedQty: 10, expectedAt: '2026-01-10T00:00:00.000Z', completedAt: '2026-01-12T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }, // late
    { quantity: 10, receivedQty: 0, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }, // still open, excluded
  ]);
  assert.equal(result.onTimeDeliveryPercent, 50);
});

test('average lead time is computed only over completed orders', () => {
  const result = computeVendorScore([
    { quantity: 10, receivedQty: 10, expectedAt: null, completedAt: '2026-01-05T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    { quantity: 10, receivedQty: 10, expectedAt: null, completedAt: '2026-01-11T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(result.averageLeadTimeDays, 7);
});

test('quality reject rate is passed through from inspection results when provided', () => {
  const result = computeVendorScore(
    [{ quantity: 10, receivedQty: 10, expectedAt: null, completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    { totalInspections: 4, failedInspections: 1 },
  );
  assert.equal(result.qualityRejectRatePercent, 25);
});

test('price variance is null with fewer than two price points', () => {
  assert.equal(computePriceVariance([]), null);
  assert.equal(computePriceVariance([{ unitCost: 10, at: '2026-01-01T00:00:00.000Z' }]), null);
});

test('price variance compares the earliest and latest price, sorted by date regardless of input order', () => {
  const result = computePriceVariance([
    { unitCost: 12, at: '2026-03-01T00:00:00.000Z' },
    { unitCost: 10, at: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(result?.earliest, 10);
  assert.equal(result?.latest, 12);
  assert.equal(result?.variancePercent, 20);
});
