import type { StockMovement } from '@prisma/client';
import type { TenantContext } from './tenant-context.js';
export declare const NEGATIVE_STOCK_POLICIES: readonly ["BLOCK", "WARN", "ALLOW"];
export type NegativeStockPolicy = (typeof NEGATIVE_STOCK_POLICIES)[number];
export declare class NegativeStockBlockedError extends Error {
    constructor(message: string);
}
export declare class MovementNotFoundError extends Error {
    constructor(movementId: string);
}
export declare class AlreadyReversedError extends Error {
    constructor(movementId: string);
}
export type PostMovementCommand = {
    tenant: TenantContext;
    itemId: string;
    lotId: string;
    locationId: string;
    movementType: string;
    qtyDelta: number;
    /** Required: retrying with the same key returns the original result instead of posting again. */
    idempotencyKey: string;
    reason?: string;
    sourceDocument?: string;
    sourceLineId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
};
export type PostMovementResult = {
    duplicate: boolean;
    movement: StockMovement;
    balance: {
        onHand: number;
    };
};
/**
 * Posts one inventory movement. Within a single DB transaction: applies the
 * balance to StockLedger with optimistic-lock retry (so two concurrent
 * posts to the same item/lot/location cannot silently overwrite each
 * other's write), inserts the immutable StockMovement journal row, writes
 * an audit log entry and enqueues a durable outbox event - all four commit
 * together or not at all.
 */
export declare function postInventoryMovement(cmd: PostMovementCommand): Promise<PostMovementResult>;
/**
 * Reversal is a compensating movement, never an edit to the original: the
 * original StockMovement row is read-only from here on. The idempotency key
 * for the reversal is derived deterministically from the original movement
 * id, so retrying a reversal request is itself idempotent through the same
 * mechanism as any other post.
 */
export declare function reverseInventoryMovement(tenant: TenantContext, originalMovementId: string, reason: string): Promise<PostMovementResult>;
