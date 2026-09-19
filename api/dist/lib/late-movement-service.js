"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyLateMovements = applyLateMovements;
exports.applyLateMovementsQuietly = applyLateMovementsQuietly;
exports.countsNeedingReconciliation = countsNeedingReconciliation;
const audit_js_1 = require("./audit.js");
const event_bus_js_1 = require("./event-bus.js");
const late_movements_js_1 = require("./late-movements.js");
const persistence_js_1 = require("./persistence.js");
const repository_js_1 = require("./repository.js");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
/**
 * Called after a sales/purchase import posts movements. Any count taken after
 * a movement's transaction time is affected: a pending count gets its book
 * quantity recomputed, an already-approved one is flagged for investigation.
 * Idempotent per movement (the dedupe key is remembered on the count).
 */
async function applyLateMovements(movements, actorId = 'system') {
    const relevant = movements
        .filter((movement) => (movement.sourceType === 'SALES' || movement.sourceType === 'PURCHASE') && movement.lotId)
        .map((movement) => ({
        key: movement.dedupeKey,
        itemId: movement.itemId,
        lotId: movement.lotId,
        locationId: movement.locationId,
        transactionAt: movement.transactionAt,
        qtyDelta: movement.qtyDelta,
    }));
    if (!relevant.length)
        return 0;
    const outcomes = (0, late_movements_js_1.planLateMovementReconciliation)(repository_js_1.counts, relevant);
    const now = new Date().toISOString();
    const touchedLocations = new Set();
    for (const outcome of outcomes) {
        const count = repository_js_1.counts.find((candidate) => candidate.id === outcome.countId);
        if (!count)
            continue;
        const before = count.bookQty;
        if (outcome.action === 'ADJUST_PENDING') {
            count.bookQtyOriginal ??= count.bookQty;
            count.bookQty = before + outcome.lateDelta;
        }
        count.lateDelta = (count.lateDelta ?? 0) + outcome.lateDelta;
        count.lateMovementKeys = [...(count.lateMovementKeys ?? []), ...outcome.keys];
        count.reconciliationRequired = true;
        count.reconciliationAt = now;
        const sources = [...new Set(movements.filter((movement) => outcome.keys.includes(movement.dedupeKey)).map((movement) => movement.sourceType.toLowerCase()))].join('/') || 'import';
        count.reconciliationNote = (0, late_movements_js_1.reconciliationNote)(outcome, before, count.bookQty, sources);
        touchedLocations.add(count.locationId);
        await (0, persistence_js_1.persistCountReconciliation)(count);
        await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
            actorId,
            actorRole: 'SYSTEM',
            action: outcome.action === 'ADJUST_PENDING' ? 'COUNT_BOOK_RECOMPUTED' : 'COUNT_RECONCILIATION_REQUIRED',
            entityType: 'StockCount',
            entityId: count.id,
            metadata: { lateDelta: outcome.lateDelta, movements: outcome.keys.length, bookBefore: before, bookAfter: count.bookQty },
        }));
    }
    for (const locationId of touchedLocations) {
        (0, event_bus_js_1.publishEvent)({ topic: 'count.changed', companyId: (0, tenant_scope_js_1.ownerOfLocation)(locationId) ?? tenant_scope_js_1.DEFAULT_COMPANY_ID, locationIds: [locationId] });
    }
    return outcomes.length;
}
/** Never lets reconciliation bookkeeping fail the import that triggered it. */
async function applyLateMovementsQuietly(movements, actorId) {
    try {
        await applyLateMovements(movements, actorId);
    }
    catch (error) {
        console.warn('Late movement reconciliation failed', error instanceof Error ? error.message : error);
    }
}
/** Counts the reviewer still has to look at because of late movements. */
function countsNeedingReconciliation() {
    return repository_js_1.counts.filter((count) => count.reconciliationRequired);
}
