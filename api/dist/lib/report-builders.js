"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferCycleReport = transferCycleReport;
exports.countAccuracyReport = countAccuracyReport;
exports.csvCell = csvCell;
exports.filterAudit = filterAudit;
exports.auditCsv = auditCsv;
// Blueprint v4 §30 Reports & audit: count accuracy by branch/user/category,
// transfer cycle time and discrepancy, and a full audit export.
const HOUR = 3_600_000;
const round1 = (value) => Math.round(value * 10) / 10;
const median = (values) => {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return round1(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};
const average = (values) => (values.length ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
/** Cycle time from request to dispatch to receipt, and whether the receipt found damage/short/excess. */
function transferCycleReport(transfers, audit, range) {
    const receivedAt = new Map();
    for (const event of audit) {
        if (event.entityType === 'Transfer' && event.action === 'TRANSFER_RECEIVED' && !receivedAt.has(event.entityId))
            receivedAt.set(event.entityId, event.createdAt);
    }
    const rows = transfers
        .filter((transfer) => (!range?.from || transfer.createdAt >= range.from) && (!range?.to || transfer.createdAt <= range.to))
        .map((transfer) => {
        const created = Date.parse(transfer.createdAt);
        const dispatched = transfer.dispatch?.dispatchedAt ? Date.parse(transfer.dispatch.dispatchedAt) : null;
        const received = receivedAt.has(transfer.id) ? Date.parse(receivedAt.get(transfer.id)) : null;
        const hours = (later, earlier) => (later !== null && earlier !== null && later >= earlier ? round1((later - earlier) / HOUR) : null);
        return {
            transferId: transfer.id, from: transfer.sourceLocationId, to: transfer.destinationLocationId, status: transfer.status,
            requestToDispatchHours: hours(dispatched, created), transitHours: hours(received, dispatched), totalHours: hours(received, created),
            discrepancy: transfer.lines.some((line) => (line.damagedQty ?? 0) + (line.shortageQty ?? 0) + (line.excessQty ?? 0) > 0),
        };
    });
    const received = rows.filter((row) => ['RECEIVED', 'CLOSED', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(row.status));
    return {
        rows,
        summary: {
            transfers: rows.length,
            received: received.length,
            avgRequestToDispatchHours: average(rows.map((row) => row.requestToDispatchHours).filter((value) => value !== null)),
            medianTransitHours: median(rows.map((row) => row.transitHours).filter((value) => value !== null)),
            avgTotalHours: average(rows.map((row) => row.totalHours).filter((value) => value !== null)),
            discrepancyRatePercent: received.length ? round1((received.filter((row) => row.discrepancy).length / received.length) * 100) : 0,
        },
    };
}
/** Share of reviewed counts that matched the book quantity, and the net variance, per branch / user / category. */
function countAccuracyReport(input) {
    const category = new Map(input.items.map((item) => [item.id, item.category ?? 'Uncategorised']));
    const groups = new Map();
    for (const count of input.counts) {
        if (input.range?.from && count.createdAt < input.range.from)
            continue;
        if (input.range?.to && count.createdAt > input.range.to)
            continue;
        const key = input.groupBy === 'branch' ? count.locationId : input.groupBy === 'user' ? count.submittedBy : category.get(count.itemId) ?? 'Uncategorised';
        const label = input.groupBy === 'branch' ? input.labels.locations.get(key) ?? key : input.groupBy === 'user' ? input.labels.users.get(key) ?? key : key;
        const row = groups.get(key) ?? { key, label, counts: 0, reviewed: 0, matched: 0, recount: 0, netVariance: 0, absVariance: 0 };
        row.counts += 1;
        if (count.status === 'RECOUNT')
            row.recount += 1;
        if (count.status === 'APPROVED' || count.status === 'REJECTED') {
            row.reviewed += 1;
            const variance = count.physicalQuantity - count.bookQty;
            if (variance === 0)
                row.matched += 1;
            row.netVariance = Math.round((row.netVariance + variance) * 1000) / 1000;
            row.absVariance = Math.round((row.absVariance + Math.abs(variance)) * 1000) / 1000;
        }
        groups.set(key, row);
    }
    return [...groups.values()]
        .map((row) => ({ ...row, accuracyPercent: row.reviewed ? round1((row.matched / row.reviewed) * 100) : null, recountRatePercent: row.counts ? round1((row.recount / row.counts) * 100) : 0 }))
        .sort((a, b) => (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101));
}
/**
 * A spreadsheet treats a cell starting with = + - @ (or a tab/CR) as a formula, so
 * a value an attacker controls (an item name, a note) could run when an auditor
 * opens the export. Such cells are prefixed with an apostrophe.
 */
function csvCell(value) {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+\-@\t\r]/.test(text))
        text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}
function filterAudit(events, filter) {
    return events.filter((event) => (!filter.actorId || event.actorId === filter.actorId)
        && (!filter.action || event.action === filter.action || event.action.startsWith(filter.action))
        && (!filter.entityType || event.entityType === filter.entityType)
        && (!filter.entityId || event.entityId === filter.entityId)
        && (!filter.from || event.createdAt >= filter.from)
        && (!filter.to || event.createdAt <= filter.to));
}
function auditCsv(events, actorNames) {
    const header = ['When', 'Actor', 'Actor ID', 'Role', 'Action', 'Entity type', 'Entity ID', 'Details'];
    const lines = events.map((event) => [event.createdAt, actorNames.get(event.actorId) ?? event.actorId, event.actorId, event.actorRole ?? '', event.action, event.entityType, event.entityId, event.metadata ?? '']);
    return [header, ...lines].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
