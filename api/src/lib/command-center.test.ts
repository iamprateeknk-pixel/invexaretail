import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommandCenter, stageSince, stuckTransfers, type CommandCenterInput } from './command-center.js';
import { auditCsv, countAccuracyReport, csvCell, filterAudit, transferCycleReport } from './report-builders.js';
import type { CountRecord, TransferRecord } from './repository.js';

const now = new Date('2026-09-19T12:00:00Z');
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

const transfer = (id: string, status: TransferRecord['status'], createdHoursAgo: number, extra: Partial<TransferRecord> = {}): TransferRecord => ({
  id, sourceLocationId: 'wh', destinationLocationId: 'st1', requestedBy: 'u', role: 'ADMIN', status,
  lines: [{ itemId: 'a', lotId: 'l', quantity: 5 }], createdAt: ago(createdHoursAgo), ...extra,
});
const count = (id: string, extra: Partial<CountRecord> = {}): CountRecord => ({
  id, itemId: 'a', lotId: 'l', locationId: 'st1', physicalQuantity: 5, bookQty: 5, mode: 'manual', submittedBy: 'u1', role: 'STORE_USER', createdAt: ago(2), status: 'APPROVED', ...extra,
});

function input(extra: Partial<CommandCenterInput> = {}): CommandCenterInput {
  return {
    now,
    locations: [{ id: 'wh', name: 'Warehouse', type: 'warehouse' }, { id: 'st1', name: 'Main Store', type: 'store' }, { id: 'st2', name: 'Second Store', type: 'store' }],
    counts: [], assignments: [], transfers: [],
    checkpoints: [{ locationId: 'st1', sourceType: 'SALES', syncedThroughAt: ago(5) }],
    audit: [], userNames: new Map([['u1', 'Asha']]), live: { clients: 3, lastEventId: 41 },
    ...extra,
  };
}

test('a transfer is stuck only when it has sat in its stage past the limit, or past its promised arrival', () => {
  assert.equal(stageSince(transfer('t', 'DISPATCHED', 100, { dispatch: { dispatchedAt: ago(10), dispatchedById: 'u' } })), ago(10));
  const result = stuckTransfers([
    transfer('fresh', 'REQUESTED', 3),
    transfer('old-request', 'REQUESTED', 30),
    transfer('in-transit', 'IN_TRANSIT', 100, { dispatch: { dispatchedAt: ago(10), dispatchedById: 'u', expectedArrivalAt: ago(1) } }),
    transfer('on-time', 'DISPATCHED', 100, { dispatch: { dispatchedAt: ago(10), dispatchedById: 'u', expectedArrivalAt: new Date(now.getTime() + 3_600_000).toISOString() } }),
    transfer('done', 'RECEIVED', 500),
  ], now);
  assert.deepEqual(result.rows.map((row) => row.transferId), ['old-request', 'in-transit']);
  assert.equal(result.rows[1].pastPromise, true);
  assert.deepEqual(result.byStage, { REQUESTED: 1, IN_TRANSIT: 1 });
});

test('branch health turns red for a stale sales import or a stuck transfer, amber for a warning, and ignores warehouses for sales', () => {
  const center = buildCommandCenter(input({
    checkpoints: [{ locationId: 'st1', sourceType: 'SALES', syncedThroughAt: ago(5) }],
    transfers: [transfer('stuck', 'REQUESTED', 40)],
    assignments: [{ id: 'a1', locationId: 'st1', itemId: 'a', assignedToId: 'u1', assignedById: 'x', countDate: ago(30).slice(0, 10), dueDate: ago(2), status: 'ASSIGNED', createdAt: ago(30) }],
  }));
  const byId = Object.fromEntries(center.branchHealth.map((row) => [row.locationId, row]));
  assert.equal(byId.st2.status, 'RED', 'no sales file was ever imported');
  assert.match(byId.st2.reasons[0], /No sales file/);
  assert.equal(byId.st1.status, 'RED', 'a transfer to it is stuck');
  assert.equal(byId.st1.overdueAssignments, 1);
  assert.equal(byId.wh.reasons.some((text) => /sales/i.test(text)), false, 'a warehouse is not expected to import sales');
  assert.equal(byId.wh.status, 'RED', 'the source branch of a stuck transfer is affected too');
  const amber = buildCommandCenter(input({ checkpoints: [{ locationId: 'st1', sourceType: 'SALES', syncedThroughAt: ago(35) }, { locationId: 'st2', sourceType: 'SALES', syncedThroughAt: ago(2) }] }));
  assert.equal(amber.branchHealth.find((row) => row.locationId === 'st1')?.status, 'AMBER');
  assert.equal(amber.branchHealth.find((row) => row.locationId === 'st2')?.status, 'GREEN');
  assert.equal(amber.branchHealth[0].status, 'AMBER', 'worst first');
});

test('attention lists the worst problems first and leaves out what is fine', () => {
  const center = buildCommandCenter(input({
    counts: [count('c1', { status: 'PENDING_REVIEW', createdAt: ago(30) }), count('c2', { status: 'PENDING_REVIEW', createdAt: ago(1), reconciliationRequired: true })],
    transfers: [transfer('stuck', 'REQUESTED', 40)],
    extras: { exceptions: { open: 4, critical: 2, overdue: 1 }, approvals: { pending: 3 } },
  }));
  assert.deepEqual(center.attention.map((row) => row.key), ['critical-exceptions', 'stuck-transfers', 'stale-sales', 'slow-review', 'reconcile', 'overdue-exceptions', 'approvals'].sort((a, b) => center.attention.findIndex((row) => row.key === a) - center.attention.findIndex((row) => row.key === b)));
  assert.equal(center.attention[0].severity, 'CRITICAL');
  assert.equal(center.attention.find((row) => row.key === 'slow-review')?.count, 1);
  assert.equal(center.attention.some((row) => row.key === 'overdue-counts'), false);
  assert.deepEqual([center.blocked.approvals, center.blocked.exceptions?.critical, center.blocked.countsAwaitingReview], [3, 2, 2]);
  assert.deepEqual([center.sync.liveClients, center.sync.lastEventId, center.sync.staleBranches, center.sync.totalBranches], [3, 41, 1, 2]);
});

test('the pulse, team table and activity feed come from counts and the audit trail', () => {
  const center = buildCommandCenter(input({
    counts: [count('c1'), count('c2', { status: 'RECOUNT' }), count('c3', { createdAt: ago(30) })],
    audit: [
      { actorId: 'u1', action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: 't1', createdAt: ago(1) },
      { actorId: 'u1', action: 'TRANSFER_CARTON_SEALED', entityType: 'Transfer', entityId: 't1', createdAt: ago(3) },
      { actorId: 'u9', action: 'STOCK_COUNT_SUBMITTED', entityType: 'StockCount', entityId: 'c1', createdAt: ago(2) },
    ],
  }));
  assert.equal(center.pulse.length, 7);
  const today = center.pulse[6];
  assert.deepEqual([today.countsSubmitted, today.receipts], [2, 1]);
  assert.equal(center.pulse[5].countsSubmitted, 1);
  const asha = center.team.find((row) => row.userId === 'u1')!;
  assert.deepEqual([asha.name, asha.counts, asha.recount, asha.recountRate, asha.receipts, asha.cartons], ['Asha', 3, 1, 33.3, 1, 1]);
  assert.equal(center.recent[0].action, 'TRANSFER_RECEIVED');
  assert.equal(center.recent[0].actor, 'Asha');
  assert.equal(center.recent.length, 3);
});

test('the heatmap shows how much of each day\'s count work is done', () => {
  const day = now.toISOString().slice(0, 10);
  const center = buildCommandCenter(input({
    assignments: [
      { id: '1', locationId: 'st1', itemId: 'a', assignedToId: 'u1', assignedById: 'x', countDate: day, status: 'SUBMITTED', createdAt: ago(3) },
      { id: '2', locationId: 'st1', itemId: 'b', assignedToId: 'u1', assignedById: 'x', countDate: day, status: 'ASSIGNED', createdAt: ago(3) },
      { id: '3', locationId: 'st1', itemId: 'c', assignedToId: 'u1', assignedById: 'x', countDate: day, status: 'CANCELLED', createdAt: ago(3) },
    ],
  }));
  assert.equal(center.heatmap.length, 1, 'branches with no count work are left out');
  const cell = center.heatmap[0].days[6];
  assert.deepEqual([cell.total, cell.done, cell.ratio], [2, 1, 0.5]);
});

// ---- reports ---------------------------------------------------------------

test('transfer cycle time runs request -> dispatch -> receipt, and discrepancy is counted only on received transfers', () => {
  const dispatched = transfer('t1', 'RECEIVED', 30, { dispatch: { dispatchedAt: ago(20), dispatchedById: 'u' }, lines: [{ itemId: 'a', lotId: 'l', quantity: 5, damagedQty: 1 }] });
  const clean = transfer('t2', 'RECEIVED', 30, { dispatch: { dispatchedAt: ago(28), dispatchedById: 'u' } });
  const open = transfer('t3', 'REQUESTED', 2);
  const audit = [
    { actorId: 'u', action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: 't1', createdAt: ago(8) },
    { actorId: 'u', action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: 't2', createdAt: ago(4) },
  ];
  const report = transferCycleReport([dispatched, clean, open], audit);
  const t1 = report.rows.find((row) => row.transferId === 't1')!;
  assert.deepEqual([t1.requestToDispatchHours, t1.transitHours, t1.totalHours, t1.discrepancy], [10, 12, 22, true]);
  assert.deepEqual([report.summary.transfers, report.summary.received, report.summary.discrepancyRatePercent], [3, 2, 50]);
  assert.equal(report.summary.avgRequestToDispatchHours, 6);
  assert.equal(report.rows.find((row) => row.transferId === 't3')?.totalHours, null);
  assert.equal(transferCycleReport([dispatched, open], audit, { from: ago(10) }).rows.length, 1, 'the date range filters on request time');
});

test('count accuracy groups by branch, user or category and lists the least accurate first', () => {
  const counts = [
    count('1', { locationId: 'st1' }), count('2', { locationId: 'st1', physicalQuantity: 3 }),
    count('3', { locationId: 'st2' }), count('4', { locationId: 'st2', status: 'RECOUNT' }),
  ];
  const labels = { locations: new Map([['st1', 'Main'], ['st2', 'Second']]), users: new Map([['u1', 'Asha']]) };
  const byBranch = countAccuracyReport({ counts, items: [], groupBy: 'branch', labels });
  assert.deepEqual(byBranch.map((row) => [row.label, row.accuracyPercent, row.netVariance]), [['Main', 50, -2], ['Second', 100, 0]]);
  assert.equal(byBranch[1].recountRatePercent, 50);
  const byUser = countAccuracyReport({ counts, items: [], groupBy: 'user', labels });
  assert.deepEqual([byUser[0].label, byUser[0].counts], ['Asha', 4]);
  const byCategory = countAccuracyReport({ counts, items: [{ id: 'a', code: 'A', name: 'A', category: 'Dairy', lots: [] }], groupBy: 'category', labels });
  assert.equal(byCategory[0].label, 'Dairy');
});

test('the audit export escapes formulas and quotes, and filters by actor, action, entity and date', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1'), `"'+1"`);
  assert.equal(csvCell('a "quoted" note'), '"a ""quoted"" note"');
  assert.equal(csvCell({ note: 'hi' }), '"{""note"":""hi""}"');
  assert.equal(csvCell(null), '""');
  const events = [
    { actorId: 'u1', actorRole: 'ADMIN', action: 'TRANSFER_DISPATCHED', entityType: 'Transfer', entityId: 't1', createdAt: '2026-09-18T10:00:00Z', metadata: { awb: '=cmd' } },
    { actorId: 'u2', action: 'STOCK_COUNT_SUBMITTED', entityType: 'StockCount', entityId: 'c1', createdAt: '2026-09-19T10:00:00Z' },
  ];
  assert.equal(filterAudit(events, { actorId: 'u1' }).length, 1);
  assert.equal(filterAudit(events, { action: 'TRANSFER' }).length, 1);
  assert.equal(filterAudit(events, { entityType: 'StockCount' }).length, 1);
  assert.equal(filterAudit(events, { from: '2026-09-19T00:00:00Z' }).length, 1);
  assert.equal(filterAudit(events, {}).length, 2);
  const csv = auditCsv(events, new Map([['u1', 'Asha']]));
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /"Asha"/);
  const hostile = auditCsv([{ ...events[0], entityId: '=SUM(A1)' }], new Map());
  assert.match(hostile.split('\r\n')[1], /"'=SUM\(A1\)"/);
});
