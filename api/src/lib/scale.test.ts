import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandCenter } from './command-center.js';
import { countAccuracyReport, transferCycleReport, auditCsv } from './report-builders.js';
import { planPurchases } from './po-planning.js';
import { allocateWeightCount } from './weight-allocation.js';
import type { CountRecord, TransferRecord } from './repository.js';

// Blueprint v4 §39 / Appendix C: "Performance tested with large item catalog and
// 5,000+ row import". The limits are generous - the point is that nothing here is
// accidentally quadratic, which would only show up on a real retail catalogue.

const now = new Date('2026-09-19T12:00:00Z');
const timed = <T,>(work: () => T): { result: T; ms: number } => {
  const begun = performance.now();
  const result = work();
  return { result, ms: performance.now() - begun };
};

test('the command center and reports stay fast on a large branch network', () => {
  const locations = Array.from({ length: 60 }, (_, index) => ({ id: `loc-${index}`, name: `Branch ${index}`, type: 'store' }));
  const counts: CountRecord[] = Array.from({ length: 50_000 }, (_, index) => ({
    id: `c${index}`, itemId: `item-${index % 5000}`, lotId: 'l', locationId: `loc-${index % 60}`, physicalQuantity: index % 7 === 0 ? 4 : 5, bookQty: 5, mode: 'manual', submittedBy: `u${index % 200}`, role: 'STORE_USER',
    createdAt: new Date(now.getTime() - (index % 168) * 3_600_000).toISOString(), status: index % 11 === 0 ? 'RECOUNT' : index % 3 === 0 ? 'PENDING_REVIEW' : 'APPROVED',
  }));
  const transfers: TransferRecord[] = Array.from({ length: 5000 }, (_, index) => ({
    id: `t${index}`, sourceLocationId: `loc-${index % 60}`, destinationLocationId: `loc-${(index + 1) % 60}`, requestedBy: 'u', role: 'ADMIN', status: index % 4 === 0 ? 'REQUESTED' : index % 4 === 1 ? 'DISPATCHED' : 'RECEIVED',
    lines: [{ itemId: 'a', lotId: 'l', quantity: 5 }], createdAt: new Date(now.getTime() - (index % 400) * 3_600_000).toISOString(),
  }));
  const audit = Array.from({ length: 50_000 }, (_, index) => ({
    actorId: `u${index % 200}`, action: index % 5 === 0 ? 'TRANSFER_RECEIVED' : 'STOCK_COUNT_SUBMITTED', entityType: 'Transfer', entityId: `t${index % 5000}`, createdAt: new Date(now.getTime() - (index % 168) * 3_600_000).toISOString(),
  }));
  const center = timed(() => buildCommandCenter({
    now, locations, counts, transfers, assignments: [], audit, userNames: new Map(), live: { clients: 0, lastEventId: 0 },
    checkpoints: locations.map((location) => ({ locationId: location.id, sourceType: 'SALES' as const, syncedThroughAt: new Date(now.getTime() - 3_600_000).toISOString() })),
  }));
  assert.equal(center.result.branchHealth.length, 60);
  assert.ok(center.ms < 4000, `command center took ${Math.round(center.ms)} ms`);
  const accuracy = timed(() => countAccuracyReport({ counts, items: [], groupBy: 'user', labels: { locations: new Map(), users: new Map() } }));
  assert.ok(accuracy.ms < 1500, `count accuracy took ${Math.round(accuracy.ms)} ms`);
  const cycle = timed(() => transferCycleReport(transfers, audit));
  assert.equal(cycle.result.summary.transfers, 5000);
  assert.ok(cycle.ms < 1500, `transfer cycle took ${Math.round(cycle.ms)} ms`);
  const csv = timed(() => auditCsv(audit, new Map()));
  assert.equal(csv.result.split('\r\n').length, 50_001);
  assert.ok(csv.ms < 3000, `audit export took ${Math.round(csv.ms)} ms`);
});

test('purchase planning and KG allocation handle a 5,000-item catalogue and a 2,000-lot item', () => {
  const items = Array.from({ length: 5000 }, (_, index) => ({
    itemId: `i${index}`, code: `SKU-${index}`, onHand: index % 20, minQty: 10, targetQty: 40, openPoQty: index % 3 === 0 ? 20 : 0, inTransitQty: 0, avgDailyDemand: (index % 9) / 3, demandDays: 30, supplierId: `s${index % 50}`,
  }));
  const suppliers = Array.from({ length: 50 }, (_, index) => ({ id: `s${index}`, name: `Supplier ${index}`, leadTimeDays: 3 + (index % 10), moq: 12, status: 'ACTIVE' }));
  const plan = timed(() => planPurchases({ items, suppliers }));
  assert.ok(plan.result.suggestions.length > 500);
  assert.ok(plan.ms < 1500, `planning took ${Math.round(plan.ms)} ms`);

  const lots = Array.from({ length: 2000 }, (_, index) => ({ lotId: `l${index}`, lotNo: `L${String(index).padStart(4, '0')}`, bookQty: 2, expiryDate: `2027-${String((index % 12) + 1).padStart(2, '0')}-15` }));
  const allocation = timed(() => allocateWeightCount(2999.5, lots, 'FEFO'));
  assert.equal(Math.round(allocation.result.reduce((sum, row) => sum + row.physicalQty, 0) * 1000) / 1000, 2999.5);
  assert.ok(allocation.ms < 500, `allocation took ${Math.round(allocation.ms)} ms`);
});
