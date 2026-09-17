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
