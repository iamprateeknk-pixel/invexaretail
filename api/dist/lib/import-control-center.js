"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayWindow = dayWindow;
exports.todayFor = todayFor;
exports.buildControlCenter = buildControlCenter;
exports.classifyImportError = classifyImportError;
exports.summarizeRowCounters = summarizeRowCounters;
const stock_take_campaign_js_1 = require("./stock-take-campaign.js");
/** The UTC instants that bound one local calendar day. */
function dayWindow(date, timezone) {
    const previous = new Date(`${date}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const previousDate = previous.toISOString().slice(0, 10);
    const from = new Date(new Date((0, stock_take_campaign_js_1.endOfLocalDayIso)(previousDate, timezone)).getTime() + 1000).toISOString();
    const to = new Date(new Date((0, stock_take_campaign_js_1.endOfLocalDayIso)(date, timezone)).getTime() + 1000).toISOString();
    return { from, to };
}
function todayFor(timezone, now = new Date()) {
    return (0, stock_take_campaign_js_1.localDateString)(now, timezone);
}
function branchStatus(movements, rejectedRows) {
    if (movements === 0)
        return 'MISSING';
    return rejectedRows > 0 ? 'PARTIAL' : 'UPLOADED';
}
function overall(branches, unattributed) {
    if (!branches.length)
        return unattributed > 0 ? 'PARTIAL' : 'MISSING';
    const anyMissing = branches.some((row) => row.status === 'MISSING');
    const anyIn = branches.some((row) => row.status !== 'MISSING');
    if (branches.every((row) => row.status === 'UPLOADED') && unattributed === 0)
        return 'UPLOADED';
    if (!anyIn)
        return unattributed > 0 ? 'PARTIAL' : 'MISSING';
    return anyMissing || unattributed > 0 || branches.some((row) => row.status === 'PARTIAL') ? 'PARTIAL' : 'UPLOADED';
}
/**
 * Sales are expected from every store, so a store with no sales that day is
 * MISSING. Purchases are only expected where they happen, so only locations
 * with purchase activity (or rejected purchase rows) are listed.
 */
function buildControlCenter(input) {
    const build = (sourceType, expected, unattributed) => {
        const rejectedKey = sourceType === 'SALES' ? 'sales' : 'purchases';
        const batchIds = new Set();
        const byLocation = new Map();
        for (const row of input.activity) {
            if (row.sourceType !== sourceType)
                continue;
            byLocation.set(row.locationId, row);
            row.batchIds.forEach((id) => batchIds.add(id));
        }
        const shown = new Map(expected.map((location) => [location.id, location]));
        for (const locationId of byLocation.keys()) {
            const known = input.locations.find((location) => location.id === locationId);
            if (known)
                shown.set(locationId, known);
        }
        for (const [locationId, rejected] of input.rejectedByLocation) {
            const known = input.locations.find((location) => location.id === locationId);
            if (known && rejected[rejectedKey] > 0)
                shown.set(locationId, known);
        }
        const branches = [...shown.values()]
            .map((location) => {
            const activity = byLocation.get(location.id);
            const rejectedRows = input.rejectedByLocation.get(location.id)?.[rejectedKey] ?? 0;
            return {
                locationId: location.id,
                locationName: location.name,
                status: branchStatus(activity?.count ?? 0, rejectedRows),
                movements: activity?.count ?? 0,
                lastTransactionAt: activity?.lastTransactionAt ?? null,
                rejectedRows,
            };
        })
            .sort((a, b) => a.locationName.localeCompare(b.locationName));
        return { status: overall(branches, unattributed), branches, batchIds: [...batchIds], unattributedRejectedRows: unattributed };
    };
    return {
        date: input.date,
        timezone: input.timezone,
        sales: build('SALES', input.locations.filter((location) => location.type === 'store'), input.unattributedRejected.sales),
        purchases: build('PURCHASE', [], input.unattributedRejected.purchases),
    };
}
/** Buckets a row-level rejection message so the preview can count unmatched items, branches and lots separately. */
function classifyImportError(message) {
    if (/is (archived|inactive|deactivated) and cannot be imported/i.test(message))
        return 'ARCHIVED_ITEM';
    if (/unknown item code|unknown or ambiguous item name|item name is unknown/i.test(message))
        return 'UNMATCHED_ITEM';
    if (/unknown branch|unknown location|branch.*(not found|unknown)/i.test(message))
        return 'UNMATCHED_BRANCH';
    if (/lot.*(not found|unknown|unmatched)|unknown lot/i.test(message))
        return 'UNMATCHED_LOT';
    return 'OTHER';
}
/** One rejected row is counted once, under its most specific reason. */
function summarizeRowCounters(rows) {
    const counters = { total: rows.length, valid: 0, duplicate: 0, unmatchedItem: 0, unmatchedBranch: 0, unmatchedLot: 0, archivedItem: 0, rejected: 0 };
    for (const row of rows) {
        if (row.status === 'VALID')
            counters.valid += 1;
        else if (row.status === 'DUPLICATE')
            counters.duplicate += 1;
        else {
            const reasons = (row.errors ?? []).map(classifyImportError);
            const reason = ['UNMATCHED_BRANCH', 'UNMATCHED_ITEM', 'ARCHIVED_ITEM', 'UNMATCHED_LOT'].find((candidate) => reasons.includes(candidate)) ?? 'OTHER';
            if (reason === 'UNMATCHED_BRANCH')
                counters.unmatchedBranch += 1;
            else if (reason === 'UNMATCHED_ITEM')
                counters.unmatchedItem += 1;
            else if (reason === 'ARCHIVED_ITEM')
                counters.archivedItem += 1;
            else if (reason === 'UNMATCHED_LOT')
                counters.unmatchedLot += 1;
            else
                counters.rejected += 1;
        }
    }
    return counters;
}
