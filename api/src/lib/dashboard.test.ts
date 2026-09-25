import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDashboardSummary, buildReportSummary } from './dashboard.js';

test('dashboard summary calculates admin KPI cards from seeded data', () => {
  const summary = buildDashboardSummary({
    counts: [{ id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', physicalQuantity: 10, bookQty: 10, mode: 'scan', submittedBy: 'u1', role: 'STORE_USER', createdAt: new Date().toISOString() }],
    transfers: [{ id: 't1', sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', requestedBy: 'u2', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: 'i1', lotId: 'l1', quantity: 4 }], createdAt: new Date().toISOString() }],
    items: [
      { id: 'i1', code: 'SKU-1', name: 'Rice', lots: [{ id: 'l1', itemId: 'i1', lotNo: 'LOT-1', expiryDate: new Date(Date.now() + 8 * 86400000).toISOString(), attributes: {} }] },
      { id: 'i2', code: 'SKU-2', name: 'Milk', lots: [{ id: 'l2', itemId: 'i2', lotNo: 'LOT-2', expiryDate: new Date(Date.now() + 40 * 86400000).toISOString(), attributes: {} }] },
      { id: 'i3', code: 'SKU-3', name: 'Soap', lots: [{ id: 'l3', itemId: 'i3', lotNo: 'LOT-3', expiryDate: new Date(Date.now() - 5 * 86400000).toISOString(), attributes: {} }] },
    ],
  });

  assert.equal(summary.pendingCounts, 1);
  assert.equal(summary.transferRequests, 1);
  assert.equal(summary.expiredTillDate, 1);
  assert.equal(summary.countCompletionPercent, 0);
  assert.equal(summary.stockAccuracyPercent, 100);
  assert.equal(summary.transferSlaPercent, 0);
});

test('report summary groups numbers for store and warehouse operations', () => {
  const report = buildReportSummary({
    locationId: 'loc-1',
    counts: [{ id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', physicalQuantity: 10, bookQty: 10, mode: 'scan', submittedBy: 'u1', role: 'STORE_USER', createdAt: new Date().toISOString() }],
    transfers: [{ id: 't1', sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', requestedBy: 'u2', role: 'ADMIN', status: 'RECEIVED', lines: [{ itemId: 'i1', lotId: 'l1', quantity: 4 }], createdAt: new Date().toISOString() }],
  });

  assert.equal(report.totalCounts, 1);
  assert.equal(report.totalTransfers, 1);
  assert.equal(report.locationId, 'loc-1');
});

// Audit P0-2: the dashboard KPIs were wrong in four ways (see dashboard.ts).
const dnow = new Date('2026-09-15T06:30:00Z'); // 12:00 IST on 15 Sep 2026
const dayIso = (isoDate: string) => `${isoDate}T00:00:00.000Z`;
const lot = (id: string, expiry: string) => ({ id, itemId: id.replace('l', 'i'), lotNo: id, expiryDate: dayIso(expiry), attributes: {} });
const dItems = [
  { id: 'i1', code: 'A', name: 'Expired with stock', lots: [lot('l1', '2026-09-10')] },
  { id: 'i2', code: 'B', name: 'Expired but zero stock', lots: [lot('l2', '2026-01-01')] },
  { id: 'i3', code: 'C', name: 'Expires today', lots: [lot('l3', '2026-09-15')] },
  { id: 'i4', code: 'D', name: 'Late this month', lots: [lot('l4', '2026-09-30')] },
  { id: 'i5', code: 'E', name: 'Mid next month', lots: [lot('l5', '2026-10-15')] },
  { id: 'i6', code: 'F', name: 'Two months out', lots: [lot('l6', '2026-11-20')] },
];
const dStock = dItems.map((item) => ({ itemId: item.id, lotId: item.lots[0].id, onHand: item.id === 'i2' ? 0 : 5 }));

test('expiry KPIs count only lots that still hold stock, and real calendar-month windows', () => {
  const summary = buildDashboardSummary({ counts: [], transfers: [], items: dItems, stock: dStock, now: dnow });
  assert.equal(summary.expiredTillDate, 1, 'only i1: i2 has no stock left, i3 expires today');
  assert.equal(summary.nearExpiryThisMonth, 2, 'i3 (today) and i4 (30 Sep)');
  assert.equal(summary.nearExpiryNextMonth, 1, 'i5 (15 Oct) - the old window was about one day wide and missed it');
});

test('pending counts are the counts still awaiting review, not every count ever submitted', () => {
  const base = { itemId: 'i', lotId: 'l', locationId: 'loc', physicalQuantity: 1, bookQty: 1, mode: 'scan' as const, submittedBy: 'u', role: 'STORE_USER' as const, createdAt: dnow.toISOString() };
  const summary = buildDashboardSummary({
    counts: [{ ...base, id: 'a' }, { ...base, id: 'b', status: 'APPROVED' }, { ...base, id: 'c', status: 'RECOUNT' }, { ...base, id: 'd', status: 'REJECTED' }],
    transfers: [], items: [], now: dnow,
  });
  assert.equal(summary.pendingCounts, 2);
});
