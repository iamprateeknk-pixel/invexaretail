"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlreadyReversedError = exports.MovementNotFoundError = exports.NegativeStockBlockedError = exports.NEGATIVE_STOCK_POLICIES = void 0;
exports.postInventoryMovement = postInventoryMovement;
exports.reverseInventoryMovement = reverseInventoryMovement;
// ADR-001 / Week 6: the canonical inventory posting service.
//
// Important correction to the Week 2 read of this codebase: `StockMovement`
// + `StockBalance` (via `routes/foundation.ts`'s old `postStockMovement`)
// looked like the live canonical path, but `routes/foundation.ts` is never
// mounted from `src/index.ts` - it is dead code, a "sketch" per its own file
// header. The actually-live balance table, written from eight places today
// (ADR-001's baseline), is `StockLedger`. A canonical posting service that
// writes to an unused table has no real value; this one posts to the table
// that is actually live.
//
// `StockMovement` remains the immutable append-only journal (rows are
// created, never edited or deleted - a reversal is a new, opposite movement
// tagged `metadata.reversalOf`) written in the same transaction as the
// `StockLedger` projection it derives from, giving the live system a real
// audit trail it did not have before, even though nothing reads it yet.
//
// Every command requires: tenant (TenantContext), location, item, lot, a
// reason or source document, an actor and an idempotency key. A duplicate
// idempotency key returns the original result rather than posting twice -
// checked up front and by catching the unique-constraint race if two
// identical retries land concurrently.
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
exports.NEGATIVE_STOCK_POLICIES = ['BLOCK', 'WARN', 'ALLOW'];
class NegativeStockBlockedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NegativeStockBlockedError';
    }
}
exports.NegativeStockBlockedError = NegativeStockBlockedError;
class MovementNotFoundError extends Error {
    constructor(movementId) {
        super(`Movement ${movementId} was not found.`);
        this.name = 'MovementNotFoundError';
    }
}
exports.MovementNotFoundError = MovementNotFoundError;
class AlreadyReversedError extends Error {
    constructor(movementId) {
        super(`Movement ${movementId} has already been reversed.`);
        this.name = 'AlreadyReversedError';
    }
}
exports.AlreadyReversedError = AlreadyReversedError;
async function resolveNegativeStockPolicy(locationId) {
    const config = await db_js_1.prisma.workflowConfiguration.findFirst({
        where: { type: 'STOCK_POSTING', scopeId: locationId },
    });
    const value = config?.negativeStockRule;
    return exports.NEGATIVE_STOCK_POLICIES.includes(value ?? '')
        ? value
        : 'BLOCK';
}
async function findByIdempotencyKey(companyId, idempotencyKey) {
    return db_js_1.prisma.stockMovement.findFirst({ where: { companyId, idempotencyKey } });
}
function isUniqueConstraintViolation(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
/**
 * Posts one inventory movement. Within a single DB transaction: applies the
 * balance to StockLedger with optimistic-lock retry (so two concurrent
 * posts to the same item/lot/location cannot silently overwrite each
 * other's write), inserts the immutable StockMovement journal row, writes
 * an audit log entry and enqueues a durable outbox event - all four commit
 * together or not at all.
 */
async function postInventoryMovement(cmd) {
    if (!cmd.idempotencyKey)
        throw new Error('idempotencyKey is required to post an inventory movement.');
    if (!cmd.lotId)
        throw new Error('lotId is required to post an inventory movement (StockLedger is lot-tracked).');
    if (!cmd.reason && !cmd.sourceDocument)
        throw new Error('A reason or sourceDocument is required to post an inventory movement.');
    const existing = await findByIdempotencyKey(cmd.tenant.companyId, cmd.idempotencyKey);
    if (existing)
        return { duplicate: true, movement: existing, balance: { onHand: existing.afterBalance } };
    const policy = await resolveNegativeStockPolicy(cmd.locationId);
    const correlationId = cmd.correlationId ?? (0, node_crypto_1.randomUUID)();
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const current = await db_js_1.prisma.stockLedger.findUnique({
            where: { itemId_lotId_locationId: { itemId: cmd.itemId, lotId: cmd.lotId, locationId: cmd.locationId } },
        }).catch(() => null);
        const beforeBalance = current?.onHand ?? 0;
        const afterBalance = beforeBalance + cmd.qtyDelta;
        if (afterBalance < 0) {
            if (policy === 'BLOCK') {
                throw new NegativeStockBlockedError(`Movement blocked: posting ${cmd.qtyDelta} would take stock to ${afterBalance} for item ${cmd.itemId}.`);
            }
            if (policy === 'WARN') {
                console.warn(`Negative stock warning: item ${cmd.itemId} location ${cmd.locationId} -> ${afterBalance}`);
            }
        }
        try {
            const movement = await db_js_1.prisma.$transaction(async (tx) => {
                const created = await tx.stockMovement.create({
                    data: {
                        itemId: cmd.itemId,
                        lotId: cmd.lotId,
                        locationId: cmd.locationId,
                        movementType: cmd.movementType,
                        qtyDelta: cmd.qtyDelta,
                        beforeBalance,
                        afterBalance,
                        sourceDocument: cmd.sourceDocument,
                        sourceLineId: cmd.sourceLineId,
                        actor: cmd.tenant.userId,
                        timestamp: new Date(),
                        correlationId,
                        reason: cmd.reason,
                        metadata: cmd.metadata,
                        companyId: cmd.tenant.companyId,
                        tenantId: cmd.tenant.tenantId,
                        idempotencyKey: cmd.idempotencyKey,
                    },
                });
                if (current) {
                    const { count } = await tx.stockLedger.updateMany({
                        where: { id: current.id, version: current.version },
                        data: { onHand: afterBalance, version: { increment: 1 } },
                    });
                    if (count === 0)
                        throw new Error('OPTIMISTIC_LOCK_LOST');
                }
                else {
                    // A unique-constraint violation here means two concurrent requests
                    // both saw no existing ledger row and raced to create it;
                    // retrying reads the now-existing row and takes the update path.
                    await tx.stockLedger.create({
                        data: {
                            itemId: cmd.itemId,
                            lotId: cmd.lotId,
                            locationId: cmd.locationId,
                            onHand: afterBalance,
                            companyId: cmd.tenant.companyId,
                            tenantId: cmd.tenant.tenantId,
                        },
                    });
                }
                await tx.auditLog.create({
                    data: {
                        id: (0, node_crypto_1.randomUUID)(),
                        actorId: cmd.tenant.userId,
                        actorRole: cmd.tenant.role,
                        action: 'STOCK_MOVEMENT_POSTED',
                        entityType: 'StockMovement',
                        entityId: created.id,
                        correlationId,
                        reason: cmd.reason,
                        tenantId: cmd.tenant.tenantId,
                        metadata: { movementType: cmd.movementType, qtyDelta: cmd.qtyDelta, itemId: cmd.itemId, locationId: cmd.locationId },
                    },
                });
                await tx.domainEventOutbox.create({
                    data: {
                        topic: 'stock.changed',
                        companyId: cmd.tenant.companyId,
                        locationIds: [cmd.locationId],
                        actorId: cmd.tenant.userId,
                    },
                });
                return created;
            });
            return { duplicate: false, movement, balance: { onHand: afterBalance } };
        }
        catch (error) {
            if (isUniqueConstraintViolation(error)) {
                // Another concurrent request with the identical idempotency key won
                // the race - this is the duplicate-retry case, not a real conflict.
                const winner = await findByIdempotencyKey(cmd.tenant.companyId, cmd.idempotencyKey);
                if (winner)
                    return { duplicate: true, movement: winner, balance: { onHand: winner.afterBalance } };
            }
            // OPTIMISTIC_LOCK_LOST or any other transient failure: retry the
            // outer loop from a fresh balance read.
            continue;
        }
    }
    throw new Error('Failed to post stock movement after concurrent-write retries; please retry the request.');
}
/**
 * Reversal is a compensating movement, never an edit to the original: the
 * original StockMovement row is read-only from here on. The idempotency key
 * for the reversal is derived deterministically from the original movement
 * id, so retrying a reversal request is itself idempotent through the same
 * mechanism as any other post.
 */
async function reverseInventoryMovement(tenant, originalMovementId, reason) {
    const original = await db_js_1.prisma.stockMovement.findFirst({ where: { id: originalMovementId, companyId: tenant.companyId } });
    if (!original)
        throw new MovementNotFoundError(originalMovementId);
    if (!original.lotId)
        throw new Error(`Movement ${originalMovementId} has no lotId and cannot be reversed through StockLedger posting.`);
    const alreadyReversed = await db_js_1.prisma.stockMovement.findFirst({
        where: { companyId: tenant.companyId, metadata: { path: ['reversalOf'], equals: original.id } },
    }).catch(() => null);
    if (alreadyReversed)
        throw new AlreadyReversedError(originalMovementId);
    return postInventoryMovement({
        tenant,
        itemId: original.itemId,
        lotId: original.lotId,
        locationId: original.locationId,
        movementType: original.movementType,
        qtyDelta: -original.qtyDelta,
        reason: reason.trim() || 'Manual reversal',
        sourceDocument: original.sourceDocument ?? undefined,
        sourceLineId: original.sourceLineId ?? undefined,
        correlationId: original.correlationId ?? undefined,
        idempotencyKey: `reversal:${original.id}`,
        metadata: { reversalOf: original.id },
    });
}
