import { DomainError } from './errors.js';
import type { Role, TransferStatus } from './inventory.js';
import { PO_STATUSES, type PoStatus } from './po-lifecycle.js';
import { type ReturnStatus, type ReturnAction } from './returns-rma.js';
import type { Prisma } from '@prisma/client';
export declare class InvalidTransitionError extends DomainError {
    readonly entity: string;
    readonly from: string;
    readonly to: string;
    constructor(entity: string, from: string, to: string, traceId?: string);
}
type AuditContext = {
    actorId: string;
    actorRole: string;
    reason?: string;
    correlationId?: string;
};
export declare function assertValidTransferTransitionAudited(role: Role, from: TransferStatus, to: TransferStatus, entityId: string, ctx: AuditContext, traceId?: string): Promise<void>;
/**
 * Persist a tenant-scoped Transfer status only after validating the live
 * database state. The status predicate in the update also turns a race into
 * a failed write instead of silently overwriting a concurrent transition.
 */
export declare function transitionTransferStatus(input: {
    entityId: string;
    companyId: string;
    to: TransferStatus;
    role: Role;
    actorId: string;
    reason?: string;
}): Promise<void>;
export declare function assertValidPurchaseOrderTransition(from: PoStatus, to: PoStatus, entityId: string, ctx: AuditContext, traceId?: string): Promise<void>;
type PurchaseOrderTransitionData = Omit<Prisma.PurchaseOrderUncheckedUpdateInput, 'status'>;
/** Tenant-scoped, compare-and-set PurchaseOrder status writer. */
export declare function transitionPurchaseOrderStatus(input: {
    entityId: string;
    companyId: string;
    to: PoStatus;
    actorId: string;
    actorRole: string;
    data?: PurchaseOrderTransitionData;
}): Promise<{
    number: string;
    companyId: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    locationId: string;
    approvedById: string | null;
    approvedAt: Date | null;
    notes: string | null;
    createdById: string;
    closedAt: Date | null;
    supplierId: string;
    expectedAt: Date | null;
    sentAt: Date | null;
    closeNote: string | null;
    totalAmount: number;
    freightCost: number | null;
    customsCost: number | null;
    insuranceCost: number | null;
    handlingCost: number | null;
    landedCostMethod: string | null;
}>;
export { PO_STATUSES };
export declare function assertValidReturnTransition(from: ReturnStatus, action: ReturnAction, entityId: string, ctx: AuditContext, traceId?: string): Promise<ReturnStatus>;
export type CountReviewStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECOUNT';
export declare const COUNT_REVIEW_STATUSES: readonly CountReviewStatus[];
export declare function allowedCountReviewMoves(from: CountReviewStatus): CountReviewStatus[];
export declare function assertValidCountReviewTransition(from: CountReviewStatus, to: CountReviewStatus, entityId: string, ctx: AuditContext, traceId?: string): Promise<void>;
export type OrderStatus = 'RESERVED' | 'BACKORDERED' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
export declare const ORDER_STATUSES: readonly OrderStatus[];
export declare function allowedOrderMoves(from: OrderStatus): OrderStatus[];
export declare function assertValidOrderTransition(from: OrderStatus, to: OrderStatus, entityId: string, ctx: AuditContext, traceId?: string): Promise<void>;
type OrderTransitionData = Omit<Prisma.OrderUncheckedUpdateInput, 'status'>;
/**
 * The only non-transactional write path for an Order status. Keeping the
 * policy assertion and the write together prevents callers from validating
 * one transition and then accidentally persisting a different status.
 */
export declare function transitionOrderStatus(entityId: string, companyId: string, from: OrderStatus, to: OrderStatus, ctx: AuditContext, data?: OrderTransitionData): Promise<void>;
/** Transaction-bound variant used when stock, lines and the status must commit atomically. */
export declare function transitionOrderStatusInTransaction(tx: Prisma.TransactionClient, entityId: string, companyId: string, from: OrderStatus, to: OrderStatus, ctx: AuditContext, data?: OrderTransitionData): Promise<void>;
export declare function assertInspectionResultImmutable(existingResult: string | null | undefined, entityId: string, traceId?: string): void;
