"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const command_center_js_1 = require("./command-center.js");
const report_builders_js_1 = require("./report-builders.js");
const now = new Date('2026-09-19T12:00:00Z');
const ago = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const transfer = (id, status, createdHoursAgo, extra = {}) => ({
    id, sourceLocationId: 'wh', destinationLocationId: 'st1', requestedBy: 'u', role: 'ADMIN', status,
    lines: [{ itemId: 'a', lotId: 'l', quantity: 5 }], createdAt: ago(createdHoursAgo), ...extra,
});
const count = (id, extra = {}) => ({
    id, itemId: 'a', lotId: 'l', locationId: 'st1', physicalQuantity: 5, bookQty: 5, mode: 'manual', submittedBy: 'u1', role: 'STORE_USER', createdAt: ago(2), status: 'APPROVED', ...extra,
});
function input(extra = {}) {
    return {
        now,
        locations: [{ id: 'wh', name: 'Warehouse', type: 'warehouse' }, { id: 'st1', name: 'Main Store', type: 'store' }, { id: 'st2', name: 'Second Store', type: 'store' }],
        counts: [], assignments: [], transfers: [],
        checkpoints: [{ locationId: 'st1', sourceType: 'SALES', syncedThroughAt: ago(5) }],
        audit: [], userNames: new Map([['u1', 'Asha']]), live: { clients: 3, lastEventId: 41 },
        ...extra,
    };
}
(0, node_test_1.default)('a transfer is stuck only when it has sat in its stage past the limit, or past its promised arrival', () => {
    strict_1.default.equal((0, command_center_js_1.stageSince)(transfer('t', 'DISPATCHED', 100, { dispatch: { dispatchedAt: ago(10), dispatchedById: 'u' } })), ago(10));
    const result = (0, command_center_js_1.stuckTransfers)([
        transfer('fresh', 'REQUESTED', 3),
        transfer('old-request', 'REQUESTED', 30),
        transfer('in-transit', 'IN_TRANSIT', 100, { dispatch: { dispatchedAt: ago(10), dispatchedById: 'u', expectedArrivalAt: ago(1) } }),
        transfer('on-time', 'DISPATCHED', 100, { dispatch: { dispatchedAt: ago(10), dispatchedById: 'u', expectedArrivalAt: new Date(now.getTime() + 3_600_000).toISOString() } }),
        transfer('done', 'RECEIVED', 500),
    ], now);
    strict_1.default.deepEqual(result.rows.map((row) => row.transferId), ['old-request', 'in-transit']);
    strict_1.default.equal(result.rows[1].pastPromise, true);
    strict_1.default.deepEqual(result.byStage, { REQUESTED: 1, IN_TRANSIT: 1 });
});
(0, node_test_1.default)('branch health turns red for a stale sales import or a stuck transfer, amber for a warning, and ignores warehouses for sales', () => {
    const center = (0, command_center_js_1.buildCommandCenter)(input({
        checkpoints: [{ locationId: 'st1', sourceType: 'SALES', syncedThroughAt: ago(5) }],
        transfers: [transfer('stuck', 'REQUESTED', 40)],
        assignments: [{ id: 'a1', locationId: 'st1', itemId: 'a', assignedToId: 'u1', assignedById: 'x', countDate: ago(30).slice(0, 10), dueDate: ago(2), status: 'ASSIGNED', createdAt: ago(30) }],
    }));
    const byId = Object.fromEntries(center.branchHealth.map((row) => [row.locationId, row]));
    strict_1.default.equal(byId.st2.status, 'RED', 'no sales file was ever imported');
    strict_1.default.match(byId.st2.reasons[0], /No sales file/);
    strict_1.default.equal(byId.st1.status, 'RED', 'a transfer to it is stuck');
    strict_1.default.equal(byId.st1.overdueAssignments, 1);
    strict_1.default.equal(byId.wh.reasons.some((text) => /sales/i.test(text)), false, 'a warehouse is not expected to import sales');
    strict_1.default.equal(byId.wh.status, 'RED', 'the source branch of a stuck transfer is affected too');
    const amber = (0, command_center_js_1.buildCommandCenter)(input({ checkpoints: [{ locationId: 'st1', sourceType: 'SALES', syncedThroughAt: ago(35) }, { locationId: 'st2', sourceType: 'SALES', syncedThroughAt: ago(2) }] }));
    strict_1.default.equal(amber.branchHealth.find((row) => row.locationId === 'st1')?.status, 'AMBER');
    strict_1.default.equal(amber.branchHealth.find((row) => row.locationId === 'st2')?.status, 'GREEN');
    strict_1.default.equal(amber.branchHealth[0].status, 'AMBER', 'worst first');
});
(0, node_test_1.default)('attention lists the worst problems first and leaves out what is fine', () => {
    const center = (0, command_center_js_1.buildCommandCenter)(input({
        counts: [count('c1', { status: 'PENDING_REVIEW', createdAt: ago(30) }), count('c2', { status: 'PENDING_REVIEW', createdAt: ago(1), reconciliationRequired: true })],
        transfers: [transfer('stuck', 'REQUESTED', 40)],
        extras: { exceptions: { open: 4, critical: 2, overdue: 1 }, approvals: { pending: 3 } },
    }));
    strict_1.default.deepEqual(center.attention.map((row) => row.key), ['critical-exceptions', 'stuck-transfers', 'stale-sales', 'slow-review', 'reconcile', 'overdue-exceptions', 'approvals'].sort((a, b) => center.attention.findIndex((row) => row.key === a) - center.attention.findIndex((row) => row.key === b)));
    strict_1.default.equal(center.attention[0].severity, 'CRITICAL');
    strict_1.default.equal(center.attention.find((row) => row.key === 'slow-review')?.count, 1);
    strict_1.default.equal(center.attention.some((row) => row.key === 'overdue-counts'), false);
    strict_1.default.deepEqual([center.blocked.approvals, center.blocked.exceptions?.critical, center.blocked.countsAwaitingReview], [3, 2, 2]);
    strict_1.default.deepEqual([center.sync.liveClients, center.sync.lastEventId, center.sync.staleBranches, center.sync.totalBranches], [3, 41, 1, 2]);
});
(0, node_test_1.default)('the pulse, team table and activity feed come from counts and the audit trail', () => {
    const center = (0, command_center_js_1.buildCommandCenter)(input({
        counts: [count('c1'), count('c2', { status: 'RECOUNT' }), count('c3', { createdAt: ago(30) })],
        audit: [
            { actorId: 'u1', action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: 't1', createdAt: ago(1) },
            { actorId: 'u1', action: 'TRANSFER_CARTON_SEALED', entityType: 'Transfer', entityId: 't1', createdAt: ago(3) },
            { actorId: 'u9', action: 'STOCK_COUNT_SUBMITTED', entityType: 'StockCount', entityId: 'c1', createdAt: ago(2) },
        ],
    }));
    strict_1.default.equal(center.pulse.length, 7);
    const today = center.pulse[6];
    strict_1.default.deepEqual([today.countsSubmitted, today.receipts], [2, 1]);
    strict_1.default.equal(center.pulse[5].countsSubmitted, 1);
    const asha = center.team.find((row) => row.userId === 'u1');
    strict_1.default.deepEqual([asha.name, asha.counts, asha.recount, asha.recountRate, asha.receipts, asha.cartons], ['Asha', 3, 1, 33.3, 1, 1]);
    strict_1.default.equal(center.recent[0].action, 'TRANSFER_RECEIVED');
    strict_1.default.equal(center.recent[0].actor, 'Asha');
    strict_1.default.equal(center.recent.length, 3);
});
(0, node_test_1.default)('the heatmap shows how much of each day\'s count work is done', () => {
    const day = now.toISOString().slice(0, 10);
    const center = (0, command_center_js_1.buildCommandCenter)(input({
        assignments: [
            { id: '1', locationId: 'st1', itemId: 'a', assignedToId: 'u1', assignedById: 'x', countDate: day, status: 'SUBMITTED', createdAt: ago(3) },
            { id: '2', locationId: 'st1', itemId: 'b', assignedToId: 'u1', assignedById: 'x', countDate: day, status: 'ASSIGNED', createdAt: ago(3) },
            { id: '3', locationId: 'st1', itemId: 'c', assignedToId: 'u1', assignedById: 'x', countDate: day, status: 'CANCELLED', createdAt: ago(3) },
        ],
    }));
    strict_1.default.equal(center.heatmap.length, 1, 'branches with no count work are left out');
    const cell = center.heatmap[0].days[6];
    strict_1.default.deepEqual([cell.total, cell.done, cell.ratio], [2, 1, 0.5]);
});
// ---- reports ---------------------------------------------------------------
(0, node_test_1.default)('transfer cycle time runs request -> dispatch -> receipt, and discrepancy is counted only on received transfers', () => {
    const dispatched = transfer('t1', 'RECEIVED', 30, { dispatch: { dispatchedAt: ago(20), dispatchedById: 'u' }, lines: [{ itemId: 'a', lotId: 'l', quantity: 5, damagedQty: 1 }] });
    const clean = transfer('t2', 'RECEIVED', 30, { dispatch: { dispatchedAt: ago(28), dispatchedById: 'u' } });
    const open = transfer('t3', 'REQUESTED', 2);
    const audit = [
        { actorId: 'u', action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: 't1', createdAt: ago(8) },
        { actorId: 'u', action: 'TRANSFER_RECEIVED', entityType: 'Transfer', entityId: 't2', createdAt: ago(4) },
    ];
    const report = (0, report_builders_js_1.transferCycleReport)([dispatched, clean, open], audit);
    const t1 = report.rows.find((row) => row.transferId === 't1');
    strict_1.default.deepEqual([t1.requestToDispatchHours, t1.transitHours, t1.totalHours, t1.discrepancy], [10, 12, 22, true]);
    strict_1.default.deepEqual([report.summary.transfers, report.summary.received, report.summary.discrepancyRatePercent], [3, 2, 50]);
    strict_1.default.equal(report.summary.avgRequestToDispatchHours, 6);
    strict_1.default.equal(report.rows.find((row) => row.transferId === 't3')?.totalHours, null);
    strict_1.default.equal((0, report_builders_js_1.transferCycleReport)([dispatched, open], audit, { from: ago(10) }).rows.length, 1, 'the date range filters on request time');
});
(0, node_test_1.default)('count accuracy groups by branch, user or category and lists the least accurate first', () => {
    const counts = [
        count('1', { locationId: 'st1' }), count('2', { locationId: 'st1', physicalQuantity: 3 }),
        count('3', { locationId: 'st2' }), count('4', { locationId: 'st2', status: 'RECOUNT' }),
    ];
    const labels = { locations: new Map([['st1', 'Main'], ['st2', 'Second']]), users: new Map([['u1', 'Asha']]) };
    const byBranch = (0, report_builders_js_1.countAccuracyReport)({ counts, items: [], groupBy: 'branch', labels });
    strict_1.default.deepEqual(byBranch.map((row) => [row.label, row.accuracyPercent, row.netVariance]), [['Main', 50, -2], ['Second', 100, 0]]);
    strict_1.default.equal(byBranch[1].recountRatePercent, 50);
    const byUser = (0, report_builders_js_1.countAccuracyReport)({ counts, items: [], groupBy: 'user', labels });
    strict_1.default.deepEqual([byUser[0].label, byUser[0].counts], ['Asha', 4]);
    const byCategory = (0, report_builders_js_1.countAccuracyReport)({ counts, items: [{ id: 'a', code: 'A', name: 'A', category: 'Dairy', lots: [] }], groupBy: 'category', labels });
    strict_1.default.equal(byCategory[0].label, 'Dairy');
});
(0, node_test_1.default)('the audit export escapes formulas and quotes, and filters by actor, action, entity and date', () => {
    strict_1.default.equal((0, report_builders_js_1.csvCell)('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    strict_1.default.equal((0, report_builders_js_1.csvCell)('+1'), `"'+1"`);
    strict_1.default.equal((0, report_builders_js_1.csvCell)('a "quoted" note'), '"a ""quoted"" note"');
    strict_1.default.equal((0, report_builders_js_1.csvCell)({ note: 'hi' }), '"{""note"":""hi""}"');
    strict_1.default.equal((0, report_builders_js_1.csvCell)(null), '""');
    const events = [
        { actorId: 'u1', actorRole: 'ADMIN', action: 'TRANSFER_DISPATCHED', entityType: 'Transfer', entityId: 't1', createdAt: '2026-09-18T10:00:00Z', metadata: { awb: '=cmd' } },
        { actorId: 'u2', action: 'STOCK_COUNT_SUBMITTED', entityType: 'StockCount', entityId: 'c1', createdAt: '2026-09-19T10:00:00Z' },
    ];
    strict_1.default.equal((0, report_builders_js_1.filterAudit)(events, { actorId: 'u1' }).length, 1);
    strict_1.default.equal((0, report_builders_js_1.filterAudit)(events, { action: 'TRANSFER' }).length, 1);
    strict_1.default.equal((0, report_builders_js_1.filterAudit)(events, { entityType: 'StockCount' }).length, 1);
    strict_1.default.equal((0, report_builders_js_1.filterAudit)(events, { from: '2026-09-19T00:00:00Z' }).length, 1);
    strict_1.default.equal((0, report_builders_js_1.filterAudit)(events, {}).length, 2);
    const csv = (0, report_builders_js_1.auditCsv)(events, new Map([['u1', 'Asha']]));
    const lines = csv.split('\r\n');
    strict_1.default.equal(lines.length, 3);
    strict_1.default.match(lines[1], /"Asha"/);
    const hostile = (0, report_builders_js_1.auditCsv)([{ ...events[0], entityId: '=SUM(A1)' }], new Map());
    strict_1.default.match(hostile.split('\r\n')[1], /"'=SUM\(A1\)"/);
});
