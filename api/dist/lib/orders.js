"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsufficientStockError = exports.OrderShortageError = void 0;
exports.routeOrder = routeOrder;
exports.expireStaleReservations = expireStaleReservations;
exports.retryBackorderAllocation = retryBackorderAllocation;
exports.retryBackorderedOrders = retryBackorderedOrders;
exports.fulfillOrder = fulfillOrder;
exports.cancelOrder = cancelOrder;
exports.normalizedExternalReference = normalizedExternalReference;
exports.findOrderByExternalReference = findOrderByExternalReference;
exports.createOrderWithReservation = createOrderWithReservation;
exports.listMemoryOrders = listMemoryOrders;
const db_js_1 = require("./db.js");
const warehouse_workflow_js_1 = require("./warehouse-workflow.js");
const reservation_js_1 = require("./reservation.js");
Object.defineProperty(exports, "InsufficientStockError", { enumerable: true, get: function () { return reservation_js_1.InsufficientStockError; } });
const order_routing_js_1 = require("./order-routing.js");
const audit_js_1 = require("./audit.js");
const persistence_js_1 = require("./persistence.js");
const repository_js_1 = require("./repository.js");
const promise_engine_js_1 = require("./promise-engine.js");
const domain_policies_js_1 = require("./domain-policies.js");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
const inventory_posting_service_js_1 = require("./inventory-posting-service.js");
// Blueprint Module G / section 13.3 (OMS & Allocation) - minimal starter:
// "Available-to-Promise (ATP) should prevent the same unit being promised
// by website, marketplace and store simultaneously." An order line names
// only an item + quantity (a webstore/marketplace order does not know
// warehouse lot numbers); this module resolves which lot(s) will fulfil it
// by FEFO against reservation-aware availability, then reserves through
// the exact same StockLedger.reserved counter a transfer request uses -
// so the two channels genuinely compete for one pool, not two.
//
// Deliberately out of scope for the original starter: marketplace connectors.
// Split fulfilment *across locations* is now implemented: auto-routing that
// cannot fill from one location will allocate across ranked candidates and
// stamp each OrderLine with its own fulfillmentLocationId.
//
// Reservation expiry: a RESERVED order gets a `reservationExpiresAt` TTL so
// an abandoned reservation does not hold stock indefinitely (previously
// unbounded). Expiry is checked lazily - same convention as the OTP/
// refresh-token session lookups in enterprise-repository.ts, no cron/
// setInterval anywhere in this app - by calling expireStaleReservations()
// wherever a stale reservation would otherwise distort the answer: before
// computing availability for a new order, and when listing orders.
//
// Backorder: an order placed against one explicit `fulfillmentLocationId`
// (not auto-routed - combining backorder with routing is the split-
// fulfilment question above, still out of scope) can opt into
// `allowBackorder`. A line FEFO can't fully satisfy now reserves whatever
// it *can* and records the shortfall as an `OrderLine` with `lotId: null`;
// the order's status becomes `BACKORDERED` instead of throwing
// `OrderShortageError`. Backordered lines are retried lazily - same
// no-cron convention as reservation expiry - wherever a stale backorder
// would distort the answer (on `GET /orders`, and on demand). There is no
// allocation-priority between two orders backordered for the same item:
// whichever is retried first (oldest `createdAt` first) claims stock that
// arrives, first-come-first-served.
const DEFAULT_RESERVATION_TTL_MINUTES = 30;
// Consistent response shape across create/list/fulfill/cancel.
const ORDER_INCLUDE = {
    lines: { include: { item: { select: { id: true, code: true, name: true } }, lot: { select: { id: true, lotNo: true } } } },
    fulfillmentLocation: { select: { id: true, code: true, name: true } },
};
class OrderShortageError extends Error {
    shortages;
    constructor(shortages) {
        super(`Insufficient available stock for ${shortages.length} order line(s).`);
        this.shortages = shortages;
        this.name = 'OrderShortageError';
    }
}
exports.OrderShortageError = OrderShortageError;
async function fefoLotsForItem(itemId, locationId) {
    const item = await db_js_1.prisma.item.findUnique({ where: { id: itemId }, include: { lots: true } });
    if (!item)
        throw new Error(`Item ${itemId} was not found.`);
    const ledgerRows = await db_js_1.prisma.stockLedger.findMany({ where: { itemId, locationId } });
    const ledgerByLot = new Map(ledgerRows.map((row) => [row.lotId, row]));
    return item.lots.map((lot) => {
        const ledger = ledgerByLot.get(lot.id);
        return {
            lotId: lot.id,
            lotNo: lot.lotNo,
            expiryDate: lot.expiryDate?.toISOString() ?? null,
            // Reservation-aware: a lot another order or transfer already claimed
            // is not offered again here.
            available: Math.max(0, (ledger?.onHand ?? 0) - (ledger?.reserved ?? 0)),
            status: lot.status ?? 'AVAILABLE',
        };
    });
}
/** Resolves every line to a specific lot by FEFO at one location. Never throws - reports a shortage instead, so a router can try the next candidate location. */
async function tryAllocateAtLocation(lines, locationId) {
    const resolved = [];
    const shortages = [];
    for (const line of lines) {
        const lots = await fefoLotsForItem(line.itemId, locationId);
        const allocation = (0, warehouse_workflow_js_1.allocateLots)(lots, line.quantity, 'FEFO');
        if (allocation.shortage > 1e-8) {
            const totalAvailable = lots.reduce((sum, lot) => sum + lot.available, 0);
            shortages.push({ itemId: line.itemId, requestedQty: line.quantity, availableQty: totalAvailable });
            continue;
        }
        for (const pick of allocation.allocations)
            resolved.push({ itemId: line.itemId, lotId: pick.lotId, quantity: pick.quantity });
    }
    return shortages.length ? { resolved: null, shortages } : { resolved, shortages: null };
}
/**
 * Like tryAllocateAtLocation, but never reports a shortage as a hard
 * failure: whatever FEFO can allocate now is kept in `resolved`, and
 * whatever it can't is reported per-item in `backordered` instead of
 * discarding the partial allocation. Used only for backorder-enabled order
 * creation - the all-or-nothing tryAllocateAtLocation stays the default,
 * and the only one routeOrder uses (routing + backorder together would be
 * split fulfilment, still out of scope).
 */
async function partialAllocateAtLocation(lines, locationId) {
    const resolved = [];
    const backordered = [];
    for (const line of lines) {
        const lots = await fefoLotsForItem(line.itemId, locationId);
        const allocation = (0, warehouse_workflow_js_1.allocateLots)(lots, line.quantity, 'FEFO');
        for (const pick of allocation.allocations)
            resolved.push({ itemId: line.itemId, lotId: pick.lotId, quantity: pick.quantity });
        if (allocation.shortage > 1e-8)
            backordered.push({ itemId: line.itemId, quantity: allocation.shortage });
    }
    return { resolved, backordered };
}
/**
 * Routing (blueprint §13.3): tries ranked candidate locations in order
 * (store before warehouse - see order-routing.ts) and returns the first
 * one that can fill the *entire* order by itself, since split fulfilment
 * across locations is out of scope for this pass. Returns null (never
 * throws) when no single location can, along with the shortage the
 * top-ranked candidate reported, so the caller has something concrete to
 * show rather than a bare "no route found."
 */
async function itemAvailabilityByLocation(itemIds, locationIds) {
    const map = new Map();
    if (!itemIds.length || !locationIds.length)
        return map;
    const rows = await db_js_1.prisma.stockLedger.findMany({
        where: { itemId: { in: itemIds }, locationId: { in: locationIds } },
        select: { itemId: true, locationId: true, onHand: true, reserved: true },
    });
    for (const row of rows) {
        const atLocation = map.get(row.locationId) ?? new Map();
        atLocation.set(row.itemId, (atLocation.get(row.itemId) ?? 0) + Math.max(0, row.onHand - row.reserved));
        map.set(row.locationId, atLocation);
    }
    return map;
}
async function routeOrder(lines, candidates, ctx = {}) {
    const ranked = (0, order_routing_js_1.rankOrderCandidates)(candidates, ctx);
    let bestShortage = [];
    for (const candidate of ranked) {
        const outcome = await tryAllocateAtLocation(lines, candidate.locationId);
        if (outcome.resolved !== null)
            return { locationId: candidate.locationId, resolved: outcome.resolved, shortages: null };
        if (!bestShortage.length)
            bestShortage = outcome.shortages;
    }
    return { locationId: null, resolved: null, shortages: bestShortage };
}
/**
 * Finds every RESERVED order whose reservation TTL has passed, releases its
 * reserved stock and flips it to EXPIRED. Never throws as a whole - one
 * order's cleanup failing must not stop the rest, or block whatever caller
 * (an availability check, a list view) triggered this sweep. Returns the
 * number of orders expired.
 */
async function expireStaleReservations() {
    if (!persistence_js_1.databaseEnabled)
        return 0;
    let expiredCount = 0;
    try {
        const stale = await db_js_1.prisma.order.findMany({
            where: { status: 'RESERVED', reservationExpiresAt: { lt: new Date() } },
            include: ORDER_INCLUDE,
        });
        for (const order of stale) {
            try {
                await (0, reservation_js_1.releaseReservedStock)(order.lines.filter((line) => line.lotId).map((line) => ({
                    itemId: line.itemId, lotId: line.lotId, locationId: line.fulfillmentLocationId || order.fulfillmentLocationId, quantity: line.requestedQty,
                })));
                await (0, domain_policies_js_1.transitionOrderStatus)(order.id, order.companyId, order.status, 'EXPIRED', {
                    actorId: 'system', actorRole: 'SYSTEM', reason: 'reservation TTL elapsed',
                }, { expiredAt: new Date() });
                await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
                    actorId: 'system', actorRole: 'SYSTEM', action: 'ORDER_RESERVATION_EXPIRED',
                    entityType: 'Order', entityId: order.id, metadata: { channel: order.channel, reservedAt: order.reservedAt },
                }));
                expiredCount += 1;
            }
            catch (error) {
                console.error(`expireStaleReservations failed for order ${order.id} (non-blocking):`, error instanceof Error ? error.message : error);
            }
        }
    }
    catch (error) {
        console.error('expireStaleReservations failed (non-blocking):', error instanceof Error ? error.message : error);
    }
    return expiredCount;
}
/**
 * Attempts to fill a single BACKORDERED order's still-open lines (lotId
 * null) from currently available stock at its fulfillment location. Any
 * quantity FEFO can now allocate is reserved and turned into a real
 * OrderLine; the backordered line's remaining requestedQty shrinks by that
 * amount (deleted once it reaches zero). Once nothing is left open, the
 * order flips to RESERVED and its reservation TTL restarts from now - the
 * clock on an actionable, ready-to-fulfill reservation should not have
 * been ticking since the order sat unfulfillable. Never throws - returns
 * the order unchanged on any internal failure.
 */
async function retryBackorderAllocation(orderId, ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES) {
    const order = await db_js_1.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
    if (!order || order.status !== 'BACKORDERED')
        return order;
    try {
        const openLines = order.lines.filter((line) => !line.lotId && line.requestedQty > 0);
        for (const line of openLines) {
            const lots = await fefoLotsForItem(line.itemId, line.fulfillmentLocationId || order.fulfillmentLocationId);
            const allocation = (0, warehouse_workflow_js_1.allocateLots)(lots, line.requestedQty, 'FEFO');
            if (!allocation.allocations.length)
                continue;
            await (0, reservation_js_1.reserveStockForTransfer)(allocation.allocations.map((pick) => ({
                itemId: line.itemId, lotId: pick.lotId, locationId: line.fulfillmentLocationId || order.fulfillmentLocationId, quantity: pick.quantity,
            })));
            const filledQty = allocation.allocations.reduce((sum, pick) => sum + pick.quantity, 0);
            await db_js_1.prisma.$transaction([
                ...allocation.allocations.map((pick) => db_js_1.prisma.orderLine.create({
                    data: { orderId: order.id, itemId: line.itemId, lotId: pick.lotId, requestedQty: pick.quantity },
                })),
                line.requestedQty - filledQty > 1e-8
                    ? db_js_1.prisma.orderLine.update({ where: { id: line.id }, data: { requestedQty: line.requestedQty - filledQty } })
                    : db_js_1.prisma.orderLine.delete({ where: { id: line.id } }),
            ]);
        }
        const remaining = await db_js_1.prisma.orderLine.count({ where: { orderId: order.id, lotId: null, requestedQty: { gt: 0 } } });
        if (remaining === 0) {
            await (0, domain_policies_js_1.transitionOrderStatus)(order.id, order.companyId, order.status, 'RESERVED', {
                actorId: 'system', actorRole: 'SYSTEM', reason: 'backorder fully allocated',
            }, { reservationExpiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000) });
            await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
                actorId: 'system', actorRole: 'SYSTEM', action: 'ORDER_BACKORDER_FILLED', entityType: 'Order', entityId: order.id,
            }));
        }
    }
    catch (error) {
        console.error(`retryBackorderAllocation failed for order ${order.id} (non-blocking):`, error instanceof Error ? error.message : error);
    }
    return db_js_1.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
}
/**
 * Retries every BACKORDERED order, oldest first - first-come-first-served
 * against whatever stock has newly arrived. Never throws as a whole, same
 * fail-open posture as expireStaleReservations. Returns how many orders
 * became fully RESERVED as a result.
 */
async function retryBackorderedOrders() {
    if (!persistence_js_1.databaseEnabled)
        return 0;
    let filledCount = 0;
    try {
        const backordered = await db_js_1.prisma.order.findMany({ where: { status: 'BACKORDERED' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        for (const { id } of backordered) {
            const updated = await retryBackorderAllocation(id);
            if (updated?.status === 'RESERVED')
                filledCount += 1;
        }
    }
    catch (error) {
        console.error('retryBackorderedOrders failed (non-blocking):', error instanceof Error ? error.message : error);
    }
    return filledCount;
}
/**
 * Resolves every line to a specific lot by FEFO and reserves all of them
 * atomically, or none. Pass `fulfillmentLocationId` to fulfil from a
 * specific location (an explicit override), or `candidateLocations` to let
 * `routeOrder` pick one automatically. Throws OrderShortageError naming
 * exactly which lines fell short (callers surface this as a 409) rather
 * than a generic message, since a channel order is often machine-consumed.
 *
 * Sweeps expired reservations first so a stale RESERVED order's stock is
 * counted as available again before this order's own availability check
 * runs, rather than only being freed the next time something else happens
 * to sweep it.
 */
async function createOrderInner(input) {
    if (!persistence_js_1.databaseEnabled)
        return createMemoryReservedOrder(input);
    await expireStaleReservations();
    let fulfillmentLocationId = input.fulfillmentLocationId ?? null;
    const resolved = [];
    let backordered = [];
    const routingCtx = { customerLatitude: input.customerLatitude, customerLongitude: input.customerLongitude };
    if (fulfillmentLocationId) {
        if (input.allowBackorder) {
            const outcome = await partialAllocateAtLocation(input.lines, fulfillmentLocationId);
            resolved.push(...outcome.resolved.map((line) => ({ ...line, locationId: fulfillmentLocationId })));
            backordered = outcome.backordered;
        }
        else {
            const outcome = await tryAllocateAtLocation(input.lines, fulfillmentLocationId);
            if (outcome.resolved === null)
                throw new OrderShortageError(outcome.shortages);
            resolved.push(...outcome.resolved.map((line) => ({ ...line, locationId: fulfillmentLocationId })));
        }
    }
    else {
        const candidates = input.candidateLocations ?? [];
        const routed = await routeOrder(input.lines, candidates, routingCtx);
        if (routed.locationId !== null && routed.resolved !== null) {
            fulfillmentLocationId = routed.locationId;
            resolved.push(...routed.resolved.map((line) => ({ ...line, locationId: routed.locationId })));
        }
        else if (input.allowSplit !== false && candidates.length) {
            const ranked = (0, order_routing_js_1.rankOrderCandidates)(candidates, routingCtx);
            const availability = await itemAvailabilityByLocation(input.lines.map((line) => line.itemId), ranked.map((row) => row.locationId));
            const split = (0, order_routing_js_1.splitLinesAcrossLocations)(input.lines, ranked, availability);
            for (const slice of split.splits) {
                const partial = await partialAllocateAtLocation(slice.lines, slice.locationId);
                resolved.push(...partial.resolved.map((line) => ({ ...line, locationId: slice.locationId })));
                backordered.push(...partial.backordered);
            }
            backordered.push(...split.remainder);
            fulfillmentLocationId = resolved[0]?.locationId ?? split.splits[0]?.locationId ?? null;
            if (!fulfillmentLocationId)
                throw new OrderShortageError(routed.shortages ?? []);
            if (backordered.length && !input.allowBackorder) {
                throw new OrderShortageError(backordered.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
            }
        }
        else {
            throw new OrderShortageError(routed.shortages ?? []);
        }
    }
    await (0, reservation_js_1.reserveStockForTransfer)(resolved.map((line) => ({
        itemId: line.itemId, lotId: line.lotId, locationId: line.locationId, quantity: line.quantity,
    })));
    const ttlMinutes = input.reservationTtlMinutes && input.reservationTtlMinutes > 0 ? input.reservationTtlMinutes : DEFAULT_RESERVATION_TTL_MINUTES;
    const status = backordered.length ? 'BACKORDERED' : 'RESERVED';
    const splitLocations = new Set(resolved.map((line) => line.locationId));
    const reservedAt = new Date();
    const fulfillmentLocationRecord = await db_js_1.prisma.location.findUnique({ where: { id: fulfillmentLocationId }, select: { deliverySlaHours: true } });
    const promise = (0, promise_engine_js_1.estimateDispatchAndDelivery)({ reservedAt, deliverySlaHours: fulfillmentLocationRecord?.deliverySlaHours, channel: input.channel });
    try {
        const order = await db_js_1.prisma.order.create({
            data: {
                channel: input.channel,
                externalReference: input.externalReference ?? null,
                status,
                fulfillmentLocationId: fulfillmentLocationId,
                customerName: input.customerName ?? null,
                notes: input.notes ?? null,
                createdById: input.createdById,
                companyId: input.companyId ?? tenant_scope_js_1.DEFAULT_COMPANY_ID,
                reservedAt,
                reservationExpiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
                estimatedDispatchAt: new Date(promise.estimatedDispatchAt),
                estimatedDeliveryAt: promise.estimatedDeliveryAt ? new Date(promise.estimatedDeliveryAt) : null,
                lines: {
                    create: [
                        ...resolved.map((line) => ({ itemId: line.itemId, lotId: line.lotId, requestedQty: line.quantity, fulfillmentLocationId: line.locationId })),
                        ...backordered.map((line) => ({ itemId: line.itemId, lotId: null, requestedQty: line.quantity, fulfillmentLocationId })),
                    ],
                },
            },
            include: ORDER_INCLUDE,
        });
        await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
            actorId: input.createdById, actorRole: 'SYSTEM', action: status === 'BACKORDERED' ? 'ORDER_BACKORDERED' : 'ORDER_RESERVED',
            entityType: 'Order', entityId: order.id,
            metadata: {
                channel: input.channel, fulfillmentLocationId, routed: !input.fulfillmentLocationId,
                split: splitLocations.size > 1, locations: [...splitLocations], lines: resolved, backordered,
            },
        }));
        return order;
    }
    catch (error) {
        await (0, reservation_js_1.releaseReservedStock)(resolved.map((line) => ({
            itemId: line.itemId, lotId: line.lotId, locationId: line.locationId, quantity: line.quantity,
        })));
        throw error;
    }
}
/**
 * Ships the order: decrements onHand for each resolved line at the
 * fulfillment location, posts an auditable StockMovement per line, and
 * releases the reservation - stock has now physically left, the same
 * sequencing already used for transfer confirmation.
 */
async function fulfillOrder(orderId, actorId) {
    await expireStaleReservations();
    const order = await db_js_1.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
    if (!order)
        throw new Error('Order was not found.');
    await db_js_1.prisma.$transaction(async (tx) => {
        for (const line of order.lines) {
            if (!line.lotId)
                continue;
            const locationId = line.fulfillmentLocationId || order.fulfillmentLocationId;
            const ledger = await tx.stockLedger.findUnique({
                where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId } },
            });
            if (!ledger || ledger.onHand < line.requestedQty) {
                throw new Error(`Stock for ${line.itemId}/${line.lotId} changed since the order was reserved; fulfillment cannot proceed.`);
            }
            // onHand leaves through the canonical service (journal + ledger + audit + outbox in
            // this transaction); the reservation counter is a separate dimension the service
            // does not model, so it is released here in the same transaction.
            await (0, inventory_posting_service_js_1.postInventoryMovementInTransaction)(tx, {
                tenant: { companyId: order.companyId, tenantId: tenant_scope_js_1.DEFAULT_TENANT_ID, userId: actorId, role: 'ADMIN' },
                itemId: line.itemId, lotId: line.lotId, locationId,
                movementType: 'SALES_DEDUCTION', qtyDelta: -line.requestedQty,
                idempotencyKey: `order-fulfill:${line.id}`,
                reason: `Order fulfilled (${order.channel})`, sourceDocument: order.id, sourceLineId: line.id, correlationId: order.id,
                metadata: { orderId: order.id, channel: order.channel },
            });
            await tx.stockLedger.update({ where: { id: ledger.id }, data: { reserved: { decrement: line.requestedQty } } });
            await tx.orderLine.update({ where: { id: line.id }, data: { fulfilledQty: line.requestedQty } });
        }
        await (0, domain_policies_js_1.transitionOrderStatusInTransaction)(tx, order.id, order.companyId, order.status, 'FULFILLED', { actorId, actorRole: 'SYSTEM' }, { fulfilledAt: new Date() });
    });
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
        actorId, actorRole: 'SYSTEM', action: 'ORDER_FULFILLED', entityType: 'Order', entityId: order.id,
        metadata: { channel: order.channel, lines: order.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: line.requestedQty })) },
    }));
    return db_js_1.prisma.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
}
/** Releases the reservation and marks the order cancelled. Refuses to cancel a fulfilled order (stock has already shipped). Idempotent for an order that already expired or was already cancelled - its reservation was already released, so it is returned as-is rather than released a second time. */
async function cancelOrder(orderId, actorId) {
    await expireStaleReservations();
    const order = await db_js_1.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
    if (!order)
        throw new Error('Order was not found.');
    if (order.status === 'CANCELLED' || order.status === 'EXPIRED')
        return order;
    // Cancellation releases reservation state outside a broader transaction,
    // so reject an illegal terminal-state move before touching stock. The
    // centralized writer validates again immediately before persisting.
    await (0, domain_policies_js_1.assertValidOrderTransition)(order.status, 'CANCELLED', order.id, { actorId, actorRole: 'SYSTEM' });
    await (0, reservation_js_1.releaseReservedStock)(order.lines.filter((line) => line.lotId).map((line) => ({
        itemId: line.itemId, lotId: line.lotId, locationId: line.fulfillmentLocationId || order.fulfillmentLocationId, quantity: line.requestedQty,
    })));
    await (0, domain_policies_js_1.transitionOrderStatus)(order.id, order.companyId, order.status, 'CANCELLED', { actorId, actorRole: 'SYSTEM' }, { cancelledAt: new Date() });
    await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({ actorId, actorRole: 'SYSTEM', action: 'ORDER_CANCELLED', entityType: 'Order', entityId: order.id }));
    return db_js_1.prisma.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
}
// Blueprint v4 §23: "Connector ingestion must be idempotent on platform +
// external order ID." A marketplace that re-delivers a webhook (retry, replay,
// double click on "ingest") gets the order that already exists - it must not
// reserve the stock a second time. Creation for one platform+reference runs
// one at a time so two simultaneous deliveries cannot both pass the lookup.
const ingestLocks = new Map();
function normalizedExternalReference(value) {
    const trimmed = (value ?? '').trim();
    return trimmed ? trimmed : null;
}
/** The order already created for this channel + external reference, if any - whatever its status, since the database allows one per pair. */
async function findOrderByExternalReference(channel, externalReference) {
    const ref = normalizedExternalReference(externalReference);
    if (!ref)
        return null;
    if (!persistence_js_1.databaseEnabled) {
        return listMemoryOrders().find((order) => order.channel === channel && order.externalReference === ref) ?? null;
    }
    return db_js_1.prisma.order.findFirst({
        where: { channel, externalReference: ref },
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'asc' },
    });
}
async function createOrderWithReservation(input) {
    const reference = normalizedExternalReference(input.externalReference);
    if (!reference)
        return createOrderInner(input);
    const key = `${input.channel} ${reference}`;
    const previous = ingestLocks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
        const existing = await findOrderByExternalReference(input.channel, reference);
        if (existing)
            return { ...existing, duplicate: true };
        return createOrderInner({ ...input, externalReference: reference });
    });
    ingestLocks.set(key, run);
    try {
        return await run;
    }
    finally {
        if (ingestLocks.get(key) === run)
            ingestLocks.delete(key);
    }
}
const memoryOrders = [];
function listMemoryOrders() {
    return memoryOrders.map((order) => ({ ...order, lines: order.lines.map((line) => ({ ...line })) }));
}
function memoryAvailability() {
    const map = new Map();
    for (const row of (0, repository_js_1.listStockLedger)()) {
        const atLocation = map.get(row.locationId) ?? new Map();
        atLocation.set(row.itemId, (atLocation.get(row.itemId) ?? 0) + Math.max(0, row.onHand));
        map.set(row.locationId, atLocation);
    }
    return map;
}
function memoryCandidates(input) {
    if (input.length)
        return input;
    return (0, repository_js_1.listLocations)().map((location) => ({
        locationId: location.id,
        locationName: location.name,
        locationType: location.type,
    }));
}
function createMemoryReservedOrder(input) {
    const candidates = memoryCandidates(input.candidateLocations ?? []);
    const availability = memoryAvailability();
    const ranked = (0, order_routing_js_1.rankOrderCandidates)(candidates, {
        customerLatitude: input.customerLatitude,
        customerLongitude: input.customerLongitude,
    });
    let slices = [];
    if (input.fulfillmentLocationId) {
        slices = [{ locationId: input.fulfillmentLocationId, lines: input.lines }];
    }
    else {
        const single = ranked.find((candidate) => {
            const atLocation = availability.get(candidate.locationId);
            return input.lines.every((line) => (atLocation?.get(line.itemId) ?? 0) >= line.quantity);
        });
        if (single) {
            slices = [{ locationId: single.locationId, lines: input.lines }];
        }
        else if (input.allowSplit !== false) {
            const split = (0, order_routing_js_1.splitLinesAcrossLocations)(input.lines, ranked, availability);
            slices = split.splits;
            if (split.remainder.length) {
                throw new OrderShortageError(split.remainder.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
            }
        }
        else {
            throw new OrderShortageError(input.lines.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
        }
    }
    if (!slices.length)
        throw new OrderShortageError(input.lines.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
    const items = (0, repository_js_1.listItems)();
    const locations = (0, repository_js_1.listLocations)();
    const primary = slices[0].locationId;
    const location = locations.find((row) => row.id === primary);
    const order = {
        id: `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        channel: input.channel,
        externalReference: input.externalReference ?? null,
        status: 'RESERVED',
        fulfillmentLocationId: primary,
        fulfillmentLocation: location ? { id: location.id, code: location.id, name: location.name } : null,
        customerName: input.customerName ?? null,
        notes: input.notes ?? null,
        createdAt: new Date().toISOString(),
        reservationExpiresAt: new Date(Date.now() + DEFAULT_RESERVATION_TTL_MINUTES * 60 * 1000).toISOString(),
        lines: slices.flatMap((slice) => slice.lines.map((line) => {
            const item = items.find((entry) => entry.id === line.itemId);
            const lot = item?.lots[0];
            return {
                id: `ol-${Math.random().toString(36).slice(2, 10)}`,
                itemId: line.itemId,
                lotId: lot?.id ?? null,
                requestedQty: line.quantity,
                fulfilledQty: 0,
                fulfillmentLocationId: slice.locationId,
                item: { id: line.itemId, code: item?.code ?? line.itemId, name: item?.name ?? line.itemId },
                lot: lot ? { id: lot.id, lotNo: lot.lotNo } : null,
            };
        })),
    };
    memoryOrders.unshift(order);
    return { ...order, lines: order.lines.map((line) => ({ ...line })) };
}
