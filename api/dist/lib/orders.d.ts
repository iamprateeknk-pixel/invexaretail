import { InsufficientStockError } from './reservation.js';
import { type LocationCandidate, type RoutingContext } from './order-routing.js';
export declare class OrderShortageError extends Error {
    readonly shortages: Array<{
        itemId: string;
        requestedQty: number;
        availableQty: number;
    }>;
    constructor(shortages: Array<{
        itemId: string;
        requestedQty: number;
        availableQty: number;
    }>);
}
export type OrderLineInput = {
    itemId: string;
    quantity: number;
};
type ResolvedLine = {
    itemId: string;
    lotId: string;
    quantity: number;
};
type Shortage = {
    itemId: string;
    requestedQty: number;
    availableQty: number;
};
export declare function routeOrder(lines: OrderLineInput[], candidates: LocationCandidate[], ctx?: RoutingContext): Promise<{
    locationId: string | null;
    resolved: ResolvedLine[] | null;
    shortages: Shortage[] | null;
}>;
/**
 * Finds every RESERVED order whose reservation TTL has passed, releases its
 * reserved stock and flips it to EXPIRED. Never throws as a whole - one
 * order's cleanup failing must not stop the rest, or block whatever caller
 * (an availability check, a list view) triggered this sweep. Returns the
 * number of orders expired.
 */
export declare function expireStaleReservations(): Promise<number>;
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
export declare function retryBackorderAllocation(orderId: string, ttlMinutes?: number): Promise<{
    lines: ({
        item: {
            name: string;
            id: string;
            code: string;
        };
        lot: {
            id: string;
            lotNo: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        itemId: string;
        lotId: string | null;
        tenantId: string;
        fulfillmentLocationId: string | null;
        requestedQty: number;
        orderId: string;
        fulfilledQty: number;
    })[];
    fulfillmentLocation: {
        name: string;
        id: string;
        code: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    notes: string | null;
    createdById: string;
    tenantId: string;
    channel: string;
    externalReference: string | null;
    fulfillmentLocationId: string;
    customerName: string | null;
    reservedAt: Date | null;
    reservationExpiresAt: Date | null;
    fulfilledAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    estimatedDispatchAt: Date | null;
    estimatedDeliveryAt: Date | null;
}>;
/**
 * Retries every BACKORDERED order, oldest first - first-come-first-served
 * against whatever stock has newly arrived. Never throws as a whole, same
 * fail-open posture as expireStaleReservations. Returns how many orders
 * became fully RESERVED as a result.
 */
export declare function retryBackorderedOrders(): Promise<number>;
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
declare function createOrderInner(input: {
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
}): Promise<({
    lines: ({
        item: {
            name: string;
            id: string;
            code: string;
        };
        lot: {
            id: string;
            lotNo: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        itemId: string;
        lotId: string | null;
        tenantId: string;
        fulfillmentLocationId: string | null;
        requestedQty: number;
        orderId: string;
        fulfilledQty: number;
    })[];
    fulfillmentLocation: {
        name: string;
        id: string;
        code: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    notes: string | null;
    createdById: string;
    tenantId: string;
    channel: string;
    externalReference: string | null;
    fulfillmentLocationId: string;
    customerName: string | null;
    reservedAt: Date | null;
    reservationExpiresAt: Date | null;
    fulfilledAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    estimatedDispatchAt: Date | null;
    estimatedDeliveryAt: Date | null;
}) | MemoryOrder>;
/**
 * Ships the order: decrements onHand for each resolved line at the
 * fulfillment location, posts an auditable StockMovement per line, and
 * releases the reservation - stock has now physically left, the same
 * sequencing already used for transfer confirmation.
 */
export declare function fulfillOrder(orderId: string, actorId: string): Promise<{
    lines: ({
        item: {
            name: string;
            id: string;
            code: string;
        };
        lot: {
            id: string;
            lotNo: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        itemId: string;
        lotId: string | null;
        tenantId: string;
        fulfillmentLocationId: string | null;
        requestedQty: number;
        orderId: string;
        fulfilledQty: number;
    })[];
    fulfillmentLocation: {
        name: string;
        id: string;
        code: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    notes: string | null;
    createdById: string;
    tenantId: string;
    channel: string;
    externalReference: string | null;
    fulfillmentLocationId: string;
    customerName: string | null;
    reservedAt: Date | null;
    reservationExpiresAt: Date | null;
    fulfilledAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    estimatedDispatchAt: Date | null;
    estimatedDeliveryAt: Date | null;
}>;
/** Releases the reservation and marks the order cancelled. Refuses to cancel a fulfilled order (stock has already shipped). Idempotent for an order that already expired or was already cancelled - its reservation was already released, so it is returned as-is rather than released a second time. */
export declare function cancelOrder(orderId: string, actorId: string): Promise<{
    lines: ({
        item: {
            name: string;
            id: string;
            code: string;
        };
        lot: {
            id: string;
            lotNo: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        itemId: string;
        lotId: string | null;
        tenantId: string;
        fulfillmentLocationId: string | null;
        requestedQty: number;
        orderId: string;
        fulfilledQty: number;
    })[];
    fulfillmentLocation: {
        name: string;
        id: string;
        code: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    notes: string | null;
    createdById: string;
    tenantId: string;
    channel: string;
    externalReference: string | null;
    fulfillmentLocationId: string;
    customerName: string | null;
    reservedAt: Date | null;
    reservationExpiresAt: Date | null;
    fulfilledAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    estimatedDispatchAt: Date | null;
    estimatedDeliveryAt: Date | null;
}>;
export declare function normalizedExternalReference(value: string | null | undefined): string | null;
/** The order already created for this channel + external reference, if any (an expired reservation may be ingested again). */
export declare function findOrderByExternalReference(channel: string, externalReference: string): Promise<({
    lines: ({
        item: {
            name: string;
            id: string;
            code: string;
        };
        lot: {
            id: string;
            lotNo: string;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        itemId: string;
        lotId: string | null;
        tenantId: string;
        fulfillmentLocationId: string | null;
        requestedQty: number;
        orderId: string;
        fulfilledQty: number;
    })[];
    fulfillmentLocation: {
        name: string;
        id: string;
        code: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    notes: string | null;
    createdById: string;
    tenantId: string;
    channel: string;
    externalReference: string | null;
    fulfillmentLocationId: string;
    customerName: string | null;
    reservedAt: Date | null;
    reservationExpiresAt: Date | null;
    fulfilledAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    estimatedDispatchAt: Date | null;
    estimatedDeliveryAt: Date | null;
}) | MemoryOrder>;
export declare function createOrderWithReservation(input: Parameters<typeof createOrderInner>[0]): Promise<Awaited<ReturnType<typeof createOrderInner>> & {
    duplicate?: boolean;
}>;
export { InsufficientStockError };
type MemoryOrder = {
    id: string;
    channel: string;
    externalReference: string | null;
    status: string;
    fulfillmentLocationId: string;
    fulfillmentLocation: {
        id: string;
        code: string;
        name: string;
    } | null;
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
        item: {
            id: string;
            code: string;
            name: string;
        };
        lot: {
            id: string;
            lotNo: string;
        } | null;
    }>;
};
export declare function listMemoryOrders(): MemoryOrder[];
