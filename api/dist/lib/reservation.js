"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_TRANSFER_STATUSES = exports.InsufficientStockError = void 0;
exports.reserveStockForTransfer = reserveStockForTransfer;
exports.releaseReservedStock = releaseReservedStock;
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
const errors_js_1 = require("./errors.js");
const event_bus_js_1 = require("./event-bus.js");
// Blueprint section 7.2 (inventory state model) + §9 (Store Replenishment &
// Transfers): "Available = On Hand - Reserved". Today `StockLedger.reserved`
// exists in the schema but nothing ever writes to it, so two concurrent
// transfer requests against the same low-stock lot can both be created -
// only the pick step later discovers the shortfall, one transfer at a time.
// This closes that gap at the point it actually happens: reserve on
// request, release on the transfer reaching any terminal state.
//
// Week 7 correction: the previous version of this file did a Prisma
// `findUnique` read, checked availability in application code, then a
// separate `update({ increment })` - all inside one `$transaction`, which
// sounds safe but is not: under Postgres's default READ COMMITTED
// isolation, two concurrent transactions can each read the same `reserved`
// value before either commits, so both can pass the availability check and
// both increment - the exact oversubscription bug this module exists to
// prevent. `version` was bumped on write but never compared on read, so it
// was decorative.
//
// Fixed by making the check and the write the same atomic statement: a
// single conditional `UPDATE ... WHERE (onHand - reserved) >= quantity`.
// Postgres evaluates and applies this under the row's own write lock, so a
// second concurrent statement for the same row physically cannot see the
// first's pre-update value - it either serializes after (and re-evaluates
// the condition against the now-larger `reserved`) or is the one that fails
// the WHERE clause. No `SELECT ... FOR UPDATE` is needed because there is
// no read-decide-write gap left to lock across.
class InsufficientStockError extends errors_js_1.DomainError {
    constructor(message, traceId) {
        super('INSUFFICIENT_STOCK', message, traceId);
        this.name = 'InsufficientStockError';
    }
}
exports.InsufficientStockError = InsufficientStockError;
/**
 * Atomically reserves every line or none of them. Lines are processed in a
 * stable sort order (itemId, lotId, locationId) so that two requests
 * reserving an overlapping set of lines always take their row-level locks
 * in the same order and cannot deadlock each other. Each line's check and
 * increment is one conditional `UPDATE`, so no two concurrent callers can
 * ever both succeed against the same over-committed row - the failing side
 * throws and the whole transaction (including any lines already updated in
 * this same call) rolls back, so a partial reservation is never left
 * behind. DB-backed only: memory-mode deployments are single-process
 * demo/dev use and have no real concurrent requests to race.
 */
async function reserveStockForTransfer(lines, options = {}) {
    if (!persistence_js_1.databaseEnabled || !lines.length)
        return;
    const traceId = options.traceId ?? (0, errors_js_1.newTraceId)();
    const ordered = [...lines].sort((a, b) => `${a.itemId}\u0000${a.lotId}\u0000${a.locationId}`.localeCompare(`${b.itemId}\u0000${b.lotId}\u0000${b.locationId}`));
    await db_js_1.prisma.$transaction(async (tx) => {
        for (const line of ordered) {
            const affected = await (0, db_js_1.executeRaw)(tx, `UPDATE "StockLedger"
         SET reserved = reserved + ?, version = version + 1
         WHERE "itemId" = ? AND "lotId" = ? AND "locationId" = ?
           AND ("onHand" - reserved) >= ?`, line.quantity, line.itemId, line.lotId, line.locationId, line.quantity);
            if (affected === 0) {
                const [existing] = await (0, db_js_1.queryRaw)(tx, `SELECT "onHand", reserved FROM "StockLedger" WHERE "itemId" = ? AND "lotId" = ? AND "locationId" = ?`, line.itemId, line.lotId, line.locationId);
                const available = existing ? existing.onHand - existing.reserved : 0;
                throw new InsufficientStockError(`Only ${Math.max(0, available)} units are available for lot ${line.lotId} at this location - ${line.quantity} were requested.`, traceId);
            }
        }
        if (options.companyId) {
            await (0, event_bus_js_1.recordOutboxEventInTransaction)(tx, {
                topic: 'stock.changed',
                companyId: options.companyId,
                locationIds: [...new Set(ordered.map((l) => l.locationId))],
                actorId: options.actorId,
                requestId: options.requestId,
            });
        }
    });
    if (options.companyId) {
        (0, event_bus_js_1.publishEvent)({
            topic: 'stock.changed',
            companyId: options.companyId,
            locationIds: [...new Set(ordered.map((l) => l.locationId))],
            actorId: options.actorId,
            requestId: options.requestId,
        });
    }
}
/**
 * Releases previously reserved quantity when a transfer reaches a terminal
 * state (confirmed, cancelled, rejected, closed). Never throws and clamps
 * at zero via the same single conditional-`UPDATE` shape as the reserve
 * path (no read-decide-write gap): a reservation-bookkeeping failure or
 * drift must not block the status change it is cleaning up after, and the
 * physical stock movement (if any) has already been posted elsewhere by
 * the time this runs.
 */
async function releaseReservedStock(lines) {
    if (!persistence_js_1.databaseEnabled || !lines.length)
        return;
    for (const line of lines) {
        try {
            await (0, db_js_1.executeRaw)(db_js_1.prisma, `UPDATE "StockLedger"
         SET reserved = GREATEST(0, reserved - ?), version = version + 1
         WHERE "itemId" = ? AND "lotId" = ? AND "locationId" = ?`, line.quantity, line.itemId, line.lotId, line.locationId);
        }
        catch (error) {
            console.error('releaseReservedStock failed (non-blocking):', error instanceof Error ? error.message : error);
        }
    }
}
exports.TERMINAL_TRANSFER_STATUSES = ['CONFIRMED', 'REJECTED', 'CANCELLED', 'CLOSED'];
