import { prisma } from './db.js';
import { allocateLots, type FefoLot } from './warehouse-workflow.js';
import { expandOrderLinesForBundles } from './bundle-expansion.js';
import { reserveStockForTransfer, releaseReservedStock, InsufficientStockError } from './reservation.js';
import { rankOrderCandidates, splitLinesAcrossLocations, type LocationCandidate, type LocationAvailability, type RoutingContext } from './order-routing.js';
import { recordAudit } from './audit.js';
import { databaseEnabled, persistAudit } from './persistence.js';
import { listItems, listLocations, listStockLedger } from './repository.js';
import { estimateDispatchAndDelivery } from './promise-engine.js';
import {
  assertValidOrderTransition,
  transitionOrderStatus,
  transitionOrderStatusInTransaction,
} from './domain-policies.js';
import { DEFAULT_COMPANY_ID, DEFAULT_TENANT_ID } from './saas/tenant-scope.js';
import { postInventoryMovementInTransaction } from './inventory-posting-service.js';

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
} as const;

export class OrderShortageError extends Error {
  constructor(public readonly shortages: Array<{ itemId: string; requestedQty: number; availableQty: number }>) {
    super(`Insufficient available stock for ${shortages.length} order line(s).`);
    this.name = 'OrderShortageError';
  }
}

export type OrderLineInput = { itemId: string; quantity: number; /** Customer's minimum remaining shelf life, as a percentage of the product's total life (audit S-1). */ minRslPercent?: number };

async function fefoLotsForItem(companyId: string, itemId: string, locationId: string): Promise<FefoLot[]> {
  const item = await prisma.item.findFirst({ where: { id: itemId, companyId }, include: { lots: true } });
  if (!item) throw new Error(`Item ${itemId} was not found.`);
  const ledgerRows = await prisma.stockLedger.findMany({ where: { itemId, locationId } });
  const ledgerByLot = new Map(ledgerRows.map((row) => [row.lotId, row]));
  return item.lots.map((lot) => {
    const ledger = ledgerByLot.get(lot.id);
    return {
      lotId: lot.id,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate?.toISOString() ?? null,
      // Reservation-aware: a lot another order or transfer already claimed
      // is not offered again here.
      available: Math.max(0, Number(ledger?.onHand ?? 0) - Number(ledger?.reserved ?? 0)),
      status: (lot.status as FefoLot['status']) ?? 'AVAILABLE',
      manufacturedAt: lot.manufacturedAt?.toISOString() ?? null,
      shelfLifeDays: item.shelfLifeDays ?? null,
    };
  });
}

type ResolvedLine = { itemId: string; lotId: string; quantity: number };
type Shortage = { itemId: string; requestedQty: number; availableQty: number };
// `resolved` is null on failure rather than a boolean-discriminated union,
// so callers narrow with a plain null check instead of relying on control
// flow analysis across an await boundary.
type AllocationOutcome = { resolved: ResolvedLine[]; shortages: null } | { resolved: null; shortages: Shortage[] };

/** Resolves every line to a specific lot by FEFO at one location. Never throws - reports a shortage instead, so a router can try the next candidate location. */
async function tryAllocateAtLocation(companyId: string, lines: OrderLineInput[], locationId: string): Promise<AllocationOutcome> {
  const resolved: ResolvedLine[] = [];
  const shortages: Shortage[] = [];
  for (const line of lines) {
    const lots = await fefoLotsForItem(companyId, line.itemId, locationId);
    const allocation = allocateLots(lots, line.quantity, 'FEFO', { minRemainingShelfLifePercent: line.minRslPercent });
    if (allocation.shortage > 1e-8) {
      const totalAvailable = lots.reduce((sum, lot) => sum + lot.available, 0);
      shortages.push({ itemId: line.itemId, requestedQty: line.quantity, availableQty: totalAvailable });
      continue;
    }
    for (const pick of allocation.allocations) resolved.push({ itemId: line.itemId, lotId: pick.lotId, quantity: pick.quantity });
  }
  return shortages.length ? { resolved: null, shortages } : { resolved, shortages: null };
}

type BackorderLine = { itemId: string; quantity: number };
type PartialAllocationOutcome = { resolved: ResolvedLine[]; backordered: BackorderLine[] };

/**
 * Like tryAllocateAtLocation, but never reports a shortage as a hard
 * failure: whatever FEFO can allocate now is kept in `resolved`, and
 * whatever it can't is reported per-item in `backordered` instead of
 * discarding the partial allocation. Used only for backorder-enabled order
 * creation - the all-or-nothing tryAllocateAtLocation stays the default,
 * and the only one routeOrder uses (routing + backorder together would be
 * split fulfilment, still out of scope).
 */
async function partialAllocateAtLocation(companyId: string, lines: OrderLineInput[], locationId: string): Promise<PartialAllocationOutcome> {
  const resolved: ResolvedLine[] = [];
  const backordered: BackorderLine[] = [];
  for (const line of lines) {
    const lots = await fefoLotsForItem(companyId, line.itemId, locationId);
    const allocation = allocateLots(lots, line.quantity, 'FEFO', { minRemainingShelfLifePercent: line.minRslPercent });
    for (const pick of allocation.allocations) resolved.push({ itemId: line.itemId, lotId: pick.lotId, quantity: pick.quantity });
    if (allocation.shortage > 1e-8) backordered.push({ itemId: line.itemId, quantity: allocation.shortage });
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
async function itemAvailabilityByLocation(companyId: string, itemIds: string[], locationIds: string[]): Promise<LocationAvailability> {
  const map: LocationAvailability = new Map();
  if (!itemIds.length || !locationIds.length) return map;
  const rows = await prisma.stockLedger.findMany({
    where: { companyId, itemId: { in: itemIds }, locationId: { in: locationIds } },
    select: { itemId: true, locationId: true, onHand: true, reserved: true },
  });
  for (const row of rows) {
    const atLocation = map.get(row.locationId) ?? new Map<string, number>();
    atLocation.set(row.itemId, (atLocation.get(row.itemId) ?? 0) + Math.max(0, Number(row.onHand) - Number(row.reserved)));
    map.set(row.locationId, atLocation);
  }
  return map;
}

export async function routeOrder(
  companyId: string,
  lines: OrderLineInput[],
  candidates: LocationCandidate[],
  ctx: RoutingContext = {},
): Promise<{ locationId: string | null; resolved: ResolvedLine[] | null; shortages: Shortage[] | null }> {
  const ranked = rankOrderCandidates(candidates, ctx);
  let bestShortage: Shortage[] = [];
  for (const candidate of ranked) {
    const outcome = await tryAllocateAtLocation(companyId, lines, candidate.locationId);
    if (outcome.resolved !== null) return { locationId: candidate.locationId, resolved: outcome.resolved, shortages: null };
    if (!bestShortage.length) bestShortage = outcome.shortages;
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
export async function expireStaleReservations(companyId: string): Promise<number> {
  if (!databaseEnabled) return 0;
  let expiredCount = 0;
  try {
    const stale = await prisma.order.findMany({
      where: { companyId, status: 'RESERVED', reservationExpiresAt: { lt: new Date() } },
      include: ORDER_INCLUDE,
    });
    for (const order of stale) {
      try {
        await releaseReservedStock(order.lines.filter((line) => line.lotId).map((line) => ({
          itemId: line.itemId, lotId: line.lotId!, locationId: line.fulfillmentLocationId || order.fulfillmentLocationId, quantity: Number(line.requestedQty),
        })), { companyId: order.companyId });
        await transitionOrderStatus(order.id, order.companyId, order.status as never, 'EXPIRED', {
          actorId: 'system', actorRole: 'SYSTEM', reason: 'reservation TTL elapsed',
        }, { expiredAt: new Date() });
        await persistAudit(recordAudit({
          actorId: 'system', actorRole: 'SYSTEM', action: 'ORDER_RESERVATION_EXPIRED',
          entityType: 'Order', entityId: order.id, metadata: { channel: order.channel, reservedAt: order.reservedAt },
        }));
        expiredCount += 1;
      } catch (error) {
        console.error(`expireStaleReservations failed for order ${order.id} (non-blocking):`, error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
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
export async function retryBackorderAllocation(companyId: string, orderId: string, ttlMinutes = DEFAULT_RESERVATION_TTL_MINUTES) {
  const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, include: ORDER_INCLUDE });
  if (!order || order.status !== 'BACKORDERED') return order;
  try {
    const openLines = order.lines.filter((line) => !line.lotId && Number(line.requestedQty) > 0);
    for (const line of openLines) {
      const lots = await fefoLotsForItem(companyId, line.itemId, line.fulfillmentLocationId || order.fulfillmentLocationId);
      const allocation = allocateLots(lots, Number(line.requestedQty), 'FEFO');
      if (!allocation.allocations.length) continue;
      await reserveStockForTransfer(allocation.allocations.map((pick) => ({
        itemId: line.itemId, lotId: pick.lotId, locationId: line.fulfillmentLocationId || order.fulfillmentLocationId, quantity: pick.quantity,
      })), { companyId });
      const filledQty = allocation.allocations.reduce((sum, pick) => sum + pick.quantity, 0);
      await prisma.$transaction([
        ...allocation.allocations.map((pick) => prisma.orderLine.create({
          data: { orderId: order.id, itemId: line.itemId, lotId: pick.lotId, requestedQty: pick.quantity },
        })),
        Number(line.requestedQty) - filledQty > 1e-8
          ? prisma.orderLine.update({ where: { id: line.id }, data: { requestedQty: Number(line.requestedQty) - filledQty } })
          : prisma.orderLine.delete({ where: { id: line.id } }),
      ]);
    }

    const remaining = await prisma.orderLine.count({ where: { orderId: order.id, lotId: null, requestedQty: { gt: 0 } } });
    if (remaining === 0) {
      await transitionOrderStatus(order.id, order.companyId, order.status as never, 'RESERVED', {
        actorId: 'system', actorRole: 'SYSTEM', reason: 'backorder fully allocated',
      }, { reservationExpiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000) });
      await persistAudit(recordAudit({
        actorId: 'system', actorRole: 'SYSTEM', action: 'ORDER_BACKORDER_FILLED', entityType: 'Order', entityId: order.id,
      }));
    }
  } catch (error) {
    console.error(`retryBackorderAllocation failed for order ${order.id} (non-blocking):`, error instanceof Error ? error.message : error);
  }
  return prisma.order.findFirst({ where: { id: orderId, companyId }, include: ORDER_INCLUDE });
}

/**
 * Retries every BACKORDERED order, oldest first - first-come-first-served
 * against whatever stock has newly arrived. Never throws as a whole, same
 * fail-open posture as expireStaleReservations. Returns how many orders
 * became fully RESERVED as a result.
 */
export async function retryBackorderedOrders(companyId: string): Promise<number> {
  if (!databaseEnabled) return 0;
  let filledCount = 0;
  try {
    const backordered = await prisma.order.findMany({ where: { companyId, status: 'BACKORDERED' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    for (const { id } of backordered) {
      const updated = await retryBackorderAllocation(companyId, id);
      if (updated?.status === 'RESERVED') filledCount += 1;
    }
  } catch (error) {
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
async function createOrderInner(input: {
  channel: string;
  externalReference?: string | null;
  fulfillmentLocationId?: string | null;
  candidateLocations?: LocationCandidate[];
  customerName?: string | null;
  notes?: string | null;
  createdById: string;
  reservationTtlMinutes?: number;
  allowBackorder?: boolean;
  allowSplit?: boolean;
  customerLatitude?: number | null;
  customerLongitude?: number | null;
  lines: OrderLineInput[];
  companyId?: string;
}) {
  if (!databaseEnabled) return createMemoryReservedOrder(input);
  const companyId = input.companyId;
  if (!companyId) throw new Error('companyId is required for database-backed orders.');
  // A bundle (kit) owns no stock: its lines become component lines, so allocation,
  // reservation and fulfilment below run on the components exactly as for any item.
  const lines = await expandOrderLinesForBundles(companyId, input.lines);
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const requestedLocationIds = [...new Set([
    ...(input.fulfillmentLocationId ? [input.fulfillmentLocationId] : []),
    ...(input.candidateLocations ?? []).map((location) => location.locationId),
  ])];
  const [ownedItems, ownedLocations, actor] = await Promise.all([
    prisma.item.count({ where: { companyId, id: { in: itemIds } } }),
    prisma.location.count({ where: { companyId, id: { in: requestedLocationIds } } }),
    prisma.user.findFirst({ where: { id: input.createdById, companyId }, select: { id: true } }),
  ]);
  if (ownedItems !== itemIds.length) throw new Error('One or more order items were not found.');
  if (ownedLocations !== requestedLocationIds.length) throw new Error('One or more fulfillment locations were not found.');
  if (!actor) throw new Error('Order creator was not found.');
  await expireStaleReservations(companyId);
  let fulfillmentLocationId = input.fulfillmentLocationId ?? null;
  const resolved: Array<ResolvedLine & { locationId: string }> = [];
  let backordered: BackorderLine[] = [];
  const routingCtx = { customerLatitude: input.customerLatitude, customerLongitude: input.customerLongitude };

  if (fulfillmentLocationId) {
    if (input.allowBackorder) {
      const outcome = await partialAllocateAtLocation(companyId, lines, fulfillmentLocationId);
      resolved.push(...outcome.resolved.map((line) => ({ ...line, locationId: fulfillmentLocationId! })));
      backordered = outcome.backordered;
    } else {
      const outcome = await tryAllocateAtLocation(companyId, lines, fulfillmentLocationId);
      if (outcome.resolved === null) throw new OrderShortageError(outcome.shortages);
      resolved.push(...outcome.resolved.map((line) => ({ ...line, locationId: fulfillmentLocationId! })));
    }
  } else {
    const candidates = input.candidateLocations ?? [];
    const routed = await routeOrder(companyId, lines, candidates, routingCtx);
    if (routed.locationId !== null && routed.resolved !== null) {
      fulfillmentLocationId = routed.locationId;
      resolved.push(...routed.resolved.map((line) => ({ ...line, locationId: routed.locationId! })));
    } else if (input.allowSplit !== false && candidates.length) {
      const ranked = rankOrderCandidates(candidates, routingCtx);
      const availability = await itemAvailabilityByLocation(companyId, lines.map((line) => line.itemId), ranked.map((row) => row.locationId));
      const split = splitLinesAcrossLocations(lines, ranked, availability);
      for (const slice of split.splits) {
        const partial = await partialAllocateAtLocation(companyId, slice.lines, slice.locationId);
        resolved.push(...partial.resolved.map((line) => ({ ...line, locationId: slice.locationId })));
        backordered.push(...partial.backordered);
      }
      backordered.push(...split.remainder);
      fulfillmentLocationId = resolved[0]?.locationId ?? split.splits[0]?.locationId ?? null;
      if (!fulfillmentLocationId) throw new OrderShortageError(routed.shortages ?? []);
      if (backordered.length && !input.allowBackorder) {
        throw new OrderShortageError(backordered.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
      }
    } else {
      throw new OrderShortageError(routed.shortages ?? []);
    }
  }

  await reserveStockForTransfer(resolved.map((line) => ({
    itemId: line.itemId, lotId: line.lotId, locationId: line.locationId, quantity: line.quantity,
  })), { companyId });

  const ttlMinutes = input.reservationTtlMinutes && input.reservationTtlMinutes > 0 ? input.reservationTtlMinutes : DEFAULT_RESERVATION_TTL_MINUTES;
  const status = backordered.length ? 'BACKORDERED' : 'RESERVED';
  const splitLocations = new Set(resolved.map((line) => line.locationId));
  const reservedAt = new Date();
  const fulfillmentLocationRecord = await prisma.location.findUnique({ where: { id: fulfillmentLocationId! }, select: { deliverySlaHours: true } });
  const promise = estimateDispatchAndDelivery({ reservedAt, deliverySlaHours: fulfillmentLocationRecord?.deliverySlaHours, channel: input.channel });
  try {
    const order = await prisma.order.create({
      data: {
        companyId,
        channel: input.channel,
        externalReference: input.externalReference ?? null,
        status,
        fulfillmentLocationId: fulfillmentLocationId!,
        customerName: input.customerName ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById,
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
    await persistAudit(recordAudit({
      actorId: input.createdById, actorRole: 'SYSTEM', action: status === 'BACKORDERED' ? 'ORDER_BACKORDERED' : 'ORDER_RESERVED',
      entityType: 'Order', entityId: order.id,
      metadata: {
        channel: input.channel, fulfillmentLocationId, routed: !input.fulfillmentLocationId,
        split: splitLocations.size > 1, locations: [...splitLocations], lines: resolved, backordered,
      },
    }));
    return order;
  } catch (error) {
    await releaseReservedStock(resolved.map((line) => ({
      itemId: line.itemId, lotId: line.lotId, locationId: line.locationId, quantity: line.quantity,
    })), { companyId });
    throw error;
  }
}

/**
 * Ships the order: decrements onHand for each resolved line at the
 * fulfillment location, posts an auditable StockMovement per line, and
 * releases the reservation - stock has now physically left, the same
 * sequencing already used for transfer confirmation.
 */
export async function fulfillOrder(companyId: string, orderId: string, actorId: string) {
  await expireStaleReservations(companyId);
  const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, include: ORDER_INCLUDE });
  if (!order) throw new Error('Order was not found.');
  await prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      if (!line.lotId) continue;
      const locationId = line.fulfillmentLocationId || order.fulfillmentLocationId;
      const ledger = await tx.stockLedger.findUnique({
        where: { companyId_itemId_lotId_locationId: { companyId: order.companyId, itemId: line.itemId, lotId: line.lotId, locationId } },
      });
      if (!ledger || Number(ledger.onHand) < Number(line.requestedQty)) {
        throw new Error(`Stock for ${line.itemId}/${line.lotId} changed since the order was reserved; fulfillment cannot proceed.`);
      }
      // onHand leaves through the canonical service (journal + ledger + audit + outbox in
      // this transaction); the reservation counter is a separate dimension the service
      // does not model, so it is released here in the same transaction.
      await postInventoryMovementInTransaction(tx, {
        tenant: { companyId: order.companyId, tenantId: DEFAULT_TENANT_ID, userId: actorId, role: 'ADMIN' },
        itemId: line.itemId, lotId: line.lotId, locationId,
        movementType: 'SALES_DEDUCTION', qtyDelta: -Number(line.requestedQty),
        idempotencyKey: `order-fulfill:${line.id}`,
        reason: `Order fulfilled (${order.channel})`, sourceDocument: order.id, sourceLineId: line.id, correlationId: order.id,
        metadata: { orderId: order.id, channel: order.channel },
      });
      await tx.stockLedger.update({ where: { id: ledger.id }, data: { reserved: { decrement: line.requestedQty } } });
      await tx.orderLine.update({ where: { id: line.id }, data: { fulfilledQty: line.requestedQty } });
    }
    await transitionOrderStatusInTransaction(
      tx,
      order.id,
      order.companyId,
      order.status as never,
      'FULFILLED',
      { actorId, actorRole: 'SYSTEM' },
      { fulfilledAt: new Date() },
    );
  });

  await persistAudit(recordAudit({
    actorId, actorRole: 'SYSTEM', action: 'ORDER_FULFILLED', entityType: 'Order', entityId: order.id,
    metadata: { channel: order.channel, lines: order.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty) })) },
  }));
  return prisma.order.findFirst({ where: { id: order.id, companyId }, include: ORDER_INCLUDE });
}

/** Releases the reservation and marks the order cancelled. Refuses to cancel a fulfilled order (stock has already shipped). Idempotent for an order that already expired or was already cancelled - its reservation was already released, so it is returned as-is rather than released a second time. */
export async function cancelOrder(companyId: string, orderId: string, actorId: string) {
  await expireStaleReservations(companyId);
  const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, include: ORDER_INCLUDE });
  if (!order) throw new Error('Order was not found.');
  if (order.status === 'CANCELLED' || order.status === 'EXPIRED') return order;
  // Cancellation releases reservation state outside a broader transaction,
  // so reject an illegal terminal-state move before touching stock. The
  // centralized writer validates again immediately before persisting.
  await assertValidOrderTransition(order.status as never, 'CANCELLED', order.id, { actorId, actorRole: 'SYSTEM' });
  await releaseReservedStock(order.lines.filter((line) => line.lotId).map((line) => ({
    itemId: line.itemId, lotId: line.lotId!, locationId: line.fulfillmentLocationId || order.fulfillmentLocationId, quantity: Number(line.requestedQty),
  })), { companyId: order.companyId });
  await transitionOrderStatus(order.id, order.companyId, order.status as never, 'CANCELLED', { actorId, actorRole: 'SYSTEM' }, { cancelledAt: new Date() });
  await persistAudit(recordAudit({ actorId, actorRole: 'SYSTEM', action: 'ORDER_CANCELLED', entityType: 'Order', entityId: order.id }));
  return prisma.order.findFirst({ where: { id: order.id, companyId }, include: ORDER_INCLUDE });
}

// Blueprint v4 §23: "Connector ingestion must be idempotent on platform +
// external order ID." A marketplace that re-delivers a webhook (retry, replay,
// double click on "ingest") gets the order that already exists - it must not
// reserve the stock a second time. Creation for one platform+reference runs
// one at a time so two simultaneous deliveries cannot both pass the lookup.
const ingestLocks = new Map<string, Promise<unknown>>();

export function normalizedExternalReference(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

/** The order already created for this channel + external reference, if any - whatever its status, since the database allows one per pair. */
export async function findOrderByExternalReference(companyId: string, channel: string, externalReference: string) {
  const ref = normalizedExternalReference(externalReference);
  if (!ref) return null;
  if (!databaseEnabled) {
    return listMemoryOrders().find((order) => order.channel === channel && order.externalReference === ref) ?? null;
  }
  return prisma.order.findFirst({
    where: { companyId, channel, externalReference: ref },
    include: ORDER_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
}

export async function createOrderWithReservation(input: Parameters<typeof createOrderInner>[0]): Promise<Awaited<ReturnType<typeof createOrderInner>> & { duplicate?: boolean }> {
  const reference = normalizedExternalReference(input.externalReference);
  if (!reference) return createOrderInner(input);
  const companyId = input.companyId;
  if (databaseEnabled && !companyId) throw new Error('companyId is required for database-backed orders.');
  const key = `${companyId ?? 'memory'} ${input.channel} ${reference}`;
  const previous = ingestLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const existing = await findOrderByExternalReference(companyId ?? DEFAULT_COMPANY_ID, input.channel, reference);
    if (existing) return { ...(existing as Awaited<ReturnType<typeof createOrderInner>>), duplicate: true };
    try {
      return await createOrderInner({ ...input, externalReference: reference });
    } catch (error) {
      // Another API replica created the same (company, channel, reference) between our lookup and our
      // insert: the unique index rejected us and createOrderInner already released our reservation.
      // That is a replay, not a failure - return the winner's order.
      if (databaseEnabled && (error as { code?: string } | null)?.code === 'P2002') {
        const winner = await findOrderByExternalReference(companyId ?? DEFAULT_COMPANY_ID, input.channel, reference);
        if (winner) return { ...(winner as Awaited<ReturnType<typeof createOrderInner>>), duplicate: true };
      }
      throw error;
    }
  });
  ingestLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (ingestLocks.get(key) === run) ingestLocks.delete(key);
  }
}

export { InsufficientStockError };

type MemoryOrder = {
  id: string;
  channel: string;
  externalReference: string | null;
  status: string;
  fulfillmentLocationId: string;
  fulfillmentLocation: { id: string; code: string; name: string } | null;
  customerName: string | null;
  notes: string | null;
  createdAt: string;
  reservationExpiresAt: string | null;
  lines: Array<{
    id: string;
    itemId: string;
    lotId: string | null;
    requestedQty: number;
    fulfilledQty: number;
    fulfillmentLocationId: string | null;
    item: { id: string; code: string; name: string };
    lot: { id: string; lotNo: string } | null;
  }>;
};

const memoryOrders: MemoryOrder[] = [];

export function listMemoryOrders(): MemoryOrder[] {
  return memoryOrders.map((order) => ({ ...order, lines: order.lines.map((line) => ({ ...line })) }));
}

function memoryAvailability(): LocationAvailability {
  const map: LocationAvailability = new Map();
  for (const row of listStockLedger()) {
    const atLocation = map.get(row.locationId) ?? new Map<string, number>();
    atLocation.set(row.itemId, (atLocation.get(row.itemId) ?? 0) + Math.max(0, row.onHand));
    map.set(row.locationId, atLocation);
  }
  return map;
}

function memoryCandidates(input: LocationCandidate[]): LocationCandidate[] {
  if (input.length) return input;
  return listLocations().map((location) => ({
    locationId: location.id,
    locationName: location.name,
    locationType: location.type,
  }));
}

function createMemoryReservedOrder(input: {
  channel: string;
  externalReference?: string | null;
  fulfillmentLocationId?: string | null;
  candidateLocations?: LocationCandidate[];
  customerName?: string | null;
  notes?: string | null;
  createdById: string;
  allowSplit?: boolean;
  customerLatitude?: number | null;
  customerLongitude?: number | null;
  lines: OrderLineInput[];
}): MemoryOrder {
  const candidates = memoryCandidates(input.candidateLocations ?? []);
  const availability = memoryAvailability();
  const ranked = rankOrderCandidates(candidates, {
    customerLatitude: input.customerLatitude,
    customerLongitude: input.customerLongitude,
  });
  let slices: Array<{ locationId: string; lines: OrderLineInput[] }> = [];
  if (input.fulfillmentLocationId) {
    slices = [{ locationId: input.fulfillmentLocationId, lines: input.lines }];
  } else {
    const single = ranked.find((candidate) => {
      const atLocation = availability.get(candidate.locationId);
      return input.lines.every((line) => (atLocation?.get(line.itemId) ?? 0) >= line.quantity);
    });
    if (single) {
      slices = [{ locationId: single.locationId, lines: input.lines }];
    } else if (input.allowSplit !== false) {
      const split = splitLinesAcrossLocations(input.lines, ranked, availability);
      slices = split.splits;
      if (split.remainder.length) {
        throw new OrderShortageError(split.remainder.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
      }
    } else {
      throw new OrderShortageError(input.lines.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
    }
  }
  if (!slices.length) throw new OrderShortageError(input.lines.map((line) => ({ itemId: line.itemId, requestedQty: line.quantity, availableQty: 0 })));
  const items = listItems();
  const locations = listLocations();
  const primary = slices[0].locationId;
  const location = locations.find((row) => row.id === primary);
  const order: MemoryOrder = {
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
