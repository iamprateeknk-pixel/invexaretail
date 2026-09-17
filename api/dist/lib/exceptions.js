"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.priorityForValue = priorityForValue;
exports.estimateValueAtRisk = estimateValueAtRisk;
exports.createExceptionCase = createExceptionCase;
exports.applyExceptionDisposition = applyExceptionDisposition;
const db_js_1 = require("./db.js");
const audit_js_1 = require("./audit.js");
const persistence_js_1 = require("./persistence.js");
// Priority mirrors the blueprint's own approval thresholds (section 16.2:
// "stock variance > 2% or > ₹5,000 -> recount + manager approval").
function priorityForValue(value) {
    const v = value ?? 0;
    if (v >= 5000)
        return 'CRITICAL';
    if (v >= 1000)
        return 'HIGH';
    if (v >= 100)
        return 'MEDIUM';
    return 'LOW';
}
// Best-effort value-at-risk: latest known purchase cost for the item times
// the exception quantity. Returns null (never throws) when no cost history
// exists yet, so priority safely falls back to LOW rather than blocking.
async function estimateValueAtRisk(itemId, quantity) {
    if (!itemId || !quantity)
        return null;
    try {
        const line = await db_js_1.prisma.purchaseOrderLine.findFirst({
            where: { itemId, unitCost: { gt: 0 } },
            orderBy: { createdAt: 'desc' },
        });
        if (!line)
            return null;
        return Number(line.unitCost) * Number(quantity);
    }
    catch {
        return null;
    }
}
/**
 * Opens a new exception case. Never throws for a missing/legacy table on
 * older Hostinger databases that predate the Exception Inbox migration -
 * callers on hot workflow paths (receiving, counting) must not fail the
 * underlying stock transaction just because the case log is unavailable.
 */
async function createExceptionCase(input) {
    try {
        const valueAtRisk = await estimateValueAtRisk(input.itemId, input.quantity);
        const priority = priorityForValue(valueAtRisk);
        const dueAt = new Date(Date.now() + (input.dueHours ?? 24) * 3_600_000);
        const exceptionCase = await db_js_1.prisma.exceptionCase.create({
            data: {
                type: input.type,
                title: input.title,
                description: input.description ?? null,
                itemId: input.itemId ?? null,
                lotId: input.lotId ?? null,
                locationId: input.locationId ?? null,
                branchId: input.branchId ?? null,
                quantity: input.quantity ?? null,
                valueAtRisk,
                priority,
                sourceDocument: input.sourceDocument ?? null,
                sourceLineId: input.sourceLineId ?? null,
                ownerId: input.ownerId ?? null,
                reportedById: input.reportedById,
                dueAt,
            },
        });
        await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
            actorId: input.reportedById,
            actorRole: 'SYSTEM',
            action: 'EXCEPTION_OPENED',
            entityType: 'ExceptionCase',
            entityId: exceptionCase.id,
            metadata: { type: input.type, sourceDocument: input.sourceDocument ?? undefined, valueAtRisk, priority },
        }));
        return exceptionCase;
    }
    catch (error) {
        console.error('createExceptionCase failed (non-blocking):', error instanceof Error ? error.message : error);
        return null;
    }
}
// Dispositions that put the physical stock back into sellable on-hand.
const RETURN_TO_STOCK = ['RESTOCK', 'MARKDOWN', 'REWORK', 'ACCEPT'];
// Dispositions that permanently remove the stock from the warehouse.
const REMOVE_FROM_STOCK = ['DESTROY', 'WRITE_OFF', 'VENDOR_RETURN'];
/**
 * Blueprint Module H: closing a case with a disposition must move the
 * physical stock it describes out of quarantine, not just record a
 * decision on paper. Only cases that actually hold quarantined quantity
 * (today: DAMAGE cases opened from receiving) have anything to move -
 * every other case type resolves as a paperwork-only decision. Never
 * throws: a stock-ledger mismatch must not block closing the case, since
 * the case's audit trail is the source of truth for what was decided.
 */
async function applyExceptionDisposition(exceptionCase, disposition, actorId) {
    if (!exceptionCase.itemId || !exceptionCase.lotId || !exceptionCase.locationId || !exceptionCase.quantity)
        return;
    if (!RETURN_TO_STOCK.includes(disposition) && !REMOVE_FROM_STOCK.includes(disposition))
        return;
    try {
        await db_js_1.prisma.$transaction(async (tx) => {
            const ledger = await tx.stockLedger.findUnique({
                where: { itemId_lotId_locationId: { itemId: exceptionCase.itemId, lotId: exceptionCase.lotId, locationId: exceptionCase.locationId } },
            });
            if (!ledger || ledger.quarantine <= 0)
                return;
            const moveQty = Math.min(Number(exceptionCase.quantity), ledger.quarantine);
            if (moveQty <= 0)
                return;
            const data = {
                quarantine: { decrement: moveQty },
                version: { increment: 1 },
            };
            if (RETURN_TO_STOCK.includes(disposition))
                data.onHand = { increment: moveQty };
            else
                data.damaged = { increment: moveQty };
            await tx.stockLedger.update({ where: { id: ledger.id }, data });
            await tx.stockMovement.create({
                data: {
                    itemId: exceptionCase.itemId,
                    lotId: exceptionCase.lotId,
                    locationId: exceptionCase.locationId,
                    movementType: RETURN_TO_STOCK.includes(disposition) ? 'ADJUSTMENT' : 'DAMAGE',
                    qtyDelta: RETURN_TO_STOCK.includes(disposition) ? moveQty : -moveQty,
                    beforeBalance: RETURN_TO_STOCK.includes(disposition) ? ledger.onHand : ledger.quarantine,
                    afterBalance: RETURN_TO_STOCK.includes(disposition) ? ledger.onHand + moveQty : ledger.quarantine - moveQty,
                    sourceDocument: 'ExceptionCase',
                    sourceLineId: exceptionCase.id,
                    actor: actorId,
                    timestamp: new Date(),
                    reason: `Exception disposition: ${disposition}`,
                    metadata: { exceptionType: exceptionCase.type, disposition },
                },
            });
        });
    }
    catch (error) {
        console.error('applyExceptionDisposition failed (non-blocking):', error instanceof Error ? error.message : error);
    }
}
