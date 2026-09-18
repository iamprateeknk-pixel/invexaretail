"use strict";
// Blueprint v4 §14 "Count Snapshot, Verification & Recount": a physical count
// is compared with the book quantity at the moment it was taken. Sales and
// purchase files arrive later (daily), so a movement dated before a count can
// be posted after it - and then the book quantity that was recorded was stale.
// These rules decide which counts that touches and what to do about it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.planLateMovementReconciliation = planLateMovementReconciliation;
exports.reconciliationNote = reconciliationNote;
/**
 * A movement is "late" for a count when it is for the same item, lot and
 * branch and its transaction time is at or before the moment the count was
 * taken - i.e. it should have been part of the book quantity then.
 */
function planLateMovementReconciliation(counts, movements) {
    const outcomes = [];
    for (const count of counts) {
        if (count.status === 'REJECTED' || count.status === 'RECOUNT')
            continue;
        const countedAt = Date.parse(count.createdAt);
        if (Number.isNaN(countedAt))
            continue;
        const already = new Set(count.lateMovementKeys ?? []);
        let lateDelta = 0;
        const keys = [];
        for (const movement of movements) {
            if (!movement.lotId)
                continue;
            if (movement.itemId !== count.itemId || movement.lotId !== count.lotId || movement.locationId !== count.locationId)
                continue;
            const at = Date.parse(movement.transactionAt);
            if (Number.isNaN(at) || at > countedAt)
                continue;
            if (already.has(movement.key) || keys.includes(movement.key))
                continue;
            lateDelta += movement.qtyDelta;
            keys.push(movement.key);
        }
        if (!keys.length)
            continue;
        outcomes.push({ countId: count.id, lateDelta, keys, action: count.status === 'APPROVED' ? 'FLAG_REVIEWED' : 'ADJUST_PENDING' });
    }
    return outcomes;
}
function reconciliationNote(outcome, before, after, sources) {
    const delta = `${outcome.lateDelta > 0 ? '+' : ''}${outcome.lateDelta}`;
    return outcome.action === 'ADJUST_PENDING'
        ? `Late ${sources} movement(s) dated before this count changed the book quantity by ${delta}: ${before} -> ${after}. Review against the recomputed figure.`
        : `Late ${sources} movement(s) dated before this count (${delta}) arrived after it was approved. The approval used the earlier book quantity - investigate whether an adjustment is needed.`;
}
