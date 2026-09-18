"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMovementActivity = loadMovementActivity;
exports.loadRejectedRows = loadRejectedRows;
const db_js_1 = require("./db.js");
const import_batch_store_js_1 = require("./import-batch-store.js");
const persistence_js_1 = require("./persistence.js");
const repository_js_1 = require("./repository.js");
const SOURCES = ['SALES', 'PURCHASE'];
/** Movements whose transaction time falls in [from, to), grouped per branch and source. */
async function loadMovementActivity(from, to) {
    if (!persistence_js_1.databaseEnabled) {
        const grouped = new Map();
        for (const movement of repository_js_1.dailyMovements) {
            if (!SOURCES.includes(movement.sourceType))
                continue;
            if (movement.transactionAt < from || movement.transactionAt >= to)
                continue;
            const key = `${movement.locationId}|${movement.sourceType}`;
            const current = grouped.get(key) ?? { locationId: movement.locationId, sourceType: movement.sourceType, count: 0, lastTransactionAt: movement.transactionAt, batchIds: [] };
            current.count += 1;
            if (movement.transactionAt > current.lastTransactionAt)
                current.lastTransactionAt = movement.transactionAt;
            if (movement.importBatchId && !current.batchIds.includes(movement.importBatchId))
                current.batchIds.push(movement.importBatchId);
            grouped.set(key, current);
        }
        return [...grouped.values()];
    }
    const where = { transactionAt: { gte: new Date(from), lt: new Date(to) }, sourceType: { in: SOURCES } };
    const [groups, batches] = await Promise.all([
        db_js_1.prisma.inventoryMovement.groupBy({ by: ['locationId', 'sourceType'], where, _count: { _all: true }, _max: { transactionAt: true } }),
        db_js_1.prisma.inventoryMovement.findMany({ where, distinct: ['locationId', 'sourceType', 'importBatchId'], select: { locationId: true, sourceType: true, importBatchId: true } }),
    ]);
    return groups.map((group) => ({
        locationId: group.locationId,
        sourceType: group.sourceType,
        count: group._count._all,
        lastTransactionAt: (group._max.transactionAt ?? new Date(from)).toISOString(),
        batchIds: batches
            .filter((row) => row.locationId === group.locationId && row.sourceType === group.sourceType && row.importBatchId)
            .map((row) => row.importBatchId),
    }));
}
const normalize = (value) => String(value ?? '').trim().toLowerCase();
/**
 * Rows the day's files rejected, attributed to a branch where the staged row
 * still names one (a row rejected for an unknown branch cannot be attributed).
 */
async function loadRejectedRows(batchIds, locations) {
    const byLocation = new Map();
    const unattributed = { sales: 0, purchases: 0 };
    for (const batchId of [...new Set(batchIds)]) {
        const batch = await (0, import_batch_store_js_1.getBatch)(batchId);
        if (!batch || (batch.type !== 'SALES' && batch.type !== 'PURCHASE'))
            continue;
        const key = batch.type === 'SALES' ? 'sales' : 'purchases';
        for (const row of await (0, import_batch_store_js_1.listRows)(batchId, 'INVALID')) {
            const location = locations.find((candidate) => normalize(candidate.name) === normalize(row.rawData?.locationName));
            if (!location) {
                unattributed[key] += 1;
                continue;
            }
            const current = byLocation.get(location.id) ?? { sales: 0, purchases: 0 };
            current[key] += 1;
            byLocation.set(location.id, current);
        }
    }
    return { byLocation, unattributed };
}
