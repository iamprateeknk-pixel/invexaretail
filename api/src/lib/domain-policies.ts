// ADR-006 / Week 7: one place that says which state transitions are legal
// for the six entities the guide names (Transfer, StockCount, PurchaseOrder,
// Order, ReturnRequest, QcInspection), and one shape for rejecting an
// illegal one: a `DomainError` with a stable `code`, a `traceId`, and a
// best-effort audit-log row naming the actor, the entity, and the reason -
// so a rejected transition is explainable from logs alone.
//
// Three of the six already had a dedicated lifecycle module before this
// week (`transfer-lifecycle.ts`, `po-lifecycle.ts`, `returns-rma.ts`) - this
// module does not replace them (their role-aware/action-aware logic stays
// where it is, and existing call sites keep calling them directly), it
// wraps their rejection into the shared `DomainError` shape and adds the
// audit-log side effect Week 7 asks for centrally, rather than duplicating
// three known-good state machines. StockCount's review workflow and Order's
// status field had no transition map at all before this week; both are new
// here. QcInspection is the one entity where "transition map" does not
// apply - see the note below.
import { randomUUID } from 'node:crypto';
import { DomainError, newTraceId } from './errors.js';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import type { Role, TransferStatus } from './inventory.js';
import { allowedTransferTransitions } from './transfer-lifecycle.js';
import { PO_STATUSES, allowedPoMoves, type PoStatus } from './po-lifecycle.js';
import { nextReturnStatus, type ReturnStatus, type ReturnAction } from './returns-rma.js';
import type { Prisma } from '@prisma/client';

export class InvalidTransitionError extends DomainError {
  constructor(
    public readonly entity: string,
    public readonly from: string,
    public readonly to: string,
    traceId?: string,
  ) {
    super('INVALID_TRANSITION', `Cannot move ${entity} from ${from} to ${to}.`, traceId);
    this.name = 'InvalidTransitionError';
  }
}

type AuditContext = { actorId: string; actorRole: string; reason?: string; correlationId?: string };

async function logRejection(entity: string, entityId: string, from: string, to: string, ctx: AuditContext, traceId: string): Promise<void> {
  if (!databaseEnabled) return;
  try {
    await prisma.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: ctx.actorId,
        actorRole: ctx.actorRole,
        action: 'TRANSITION_REJECTED',
        entityType: entity,
        entityId,
        reason: ctx.reason,
        correlationId: ctx.correlationId ?? traceId,
        metadata: { from, to, traceId } as never,
      },
    });
  } catch (error) {
    // Auditability of a rejection must never itself block the rejection
    // (or, worse, let the caller's transaction fail on something unrelated
    // to the business rule it's enforcing) - log and move on.
    console.error('[domain-policies] failed to record transition-rejection audit log', error);
  }
}

// --- Transfer -----------------------------------------------------------
// Delegates to transfer-lifecycle.ts's existing role+status map.

export async function assertValidTransferTransitionAudited(
  role: Role,
  from: TransferStatus,
  to: TransferStatus,
  entityId: string,
  ctx: AuditContext,
  traceId: string = newTraceId(),
): Promise<void> {
  if (allowedTransferTransitions(role, from).includes(to)) return;
  await logRejection('Transfer', entityId, from, to, ctx, traceId);
  throw new InvalidTransitionError('Transfer', from, to, traceId);
}

// --- PurchaseOrder --------------------------------------------------------
// Delegates to po-lifecycle.ts's existing MOVES table.

export async function assertValidPurchaseOrderTransition(
  from: PoStatus,
  to: PoStatus,
  entityId: string,
  ctx: AuditContext,
  traceId: string = newTraceId(),
): Promise<void> {
  if (allowedPoMoves(from).includes(to)) return;
  await logRejection('PurchaseOrder', entityId, from, to, ctx, traceId);
  throw new InvalidTransitionError('PurchaseOrder', from, to, traceId);
}

export { PO_STATUSES };

// --- ReturnRequest --------------------------------------------------------
// Delegates to returns-rma.ts's existing action-keyed TRANSITIONS table.

export async function assertValidReturnTransition(
  from: ReturnStatus,
  action: ReturnAction,
  entityId: string,
  ctx: AuditContext,
  traceId: string = newTraceId(),
): Promise<ReturnStatus> {
  const to = nextReturnStatus(from, action);
  if (to) return to;
  await logRejection('ReturnRequest', entityId, from, action, ctx, traceId);
  throw new InvalidTransitionError('ReturnRequest', from, action, traceId);
}

// --- StockCount (review workflow) -----------------------------------------
// New this week: `StockCount.reviewStatus` had no transition map before -
// `lib/persistence.ts`'s `persistCountReview` only guarded with an
// optimistic `WHERE reviewStatus = 'PENDING_REVIEW'` claim, which stops two
// concurrent reviews of the same count but does not name which *target*
// statuses are legal from which starting point.

export type CountReviewStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECOUNT';
export const COUNT_REVIEW_STATUSES: readonly CountReviewStatus[] = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RECOUNT'];

const COUNT_REVIEW_MOVES: Record<CountReviewStatus, CountReviewStatus[]> = {
  PENDING_REVIEW: ['APPROVED', 'REJECTED', 'RECOUNT'],
  RECOUNT: ['PENDING_REVIEW'],
  APPROVED: [],
  REJECTED: [],
};

export function allowedCountReviewMoves(from: CountReviewStatus): CountReviewStatus[] {
  return COUNT_REVIEW_MOVES[from] ?? [];
}

export async function assertValidCountReviewTransition(
  from: CountReviewStatus,
  to: CountReviewStatus,
  entityId: string,
  ctx: AuditContext,
  traceId: string = newTraceId(),
): Promise<void> {
  if (allowedCountReviewMoves(from).includes(to)) return;
  await logRejection('StockCount', entityId, from, to, ctx, traceId);
  throw new InvalidTransitionError('StockCount', from, to, traceId);
}

// --- Order ------------------------------------------------------------
// New this week: `lib/orders.ts` wrote `status` directly at four call
// sites (reservation, expiry sweep, fulfillment, cancellation) with no
// shared legality table.

export type OrderStatus = 'RESERVED' | 'BACKORDERED' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
export const ORDER_STATUSES: readonly OrderStatus[] = ['RESERVED', 'BACKORDERED', 'FULFILLED', 'CANCELLED', 'EXPIRED'];

const ORDER_MOVES: Record<OrderStatus, OrderStatus[]> = {
  RESERVED: ['FULFILLED', 'CANCELLED', 'EXPIRED', 'BACKORDERED'],
  BACKORDERED: ['RESERVED', 'CANCELLED'],
  FULFILLED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function allowedOrderMoves(from: OrderStatus): OrderStatus[] {
  return ORDER_MOVES[from] ?? [];
}

export async function assertValidOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  entityId: string,
  ctx: AuditContext,
  traceId: string = newTraceId(),
): Promise<void> {
  if (allowedOrderMoves(from).includes(to)) return;
  await logRejection('Order', entityId, from, to, ctx, traceId);
  throw new InvalidTransitionError('Order', from, to, traceId);
}

type OrderTransitionData = Omit<Prisma.OrderUncheckedUpdateInput, 'status'>;

/**
 * The only non-transactional write path for an Order status. Keeping the
 * policy assertion and the write together prevents callers from validating
 * one transition and then accidentally persisting a different status.
 */
export async function transitionOrderStatus(
  entityId: string,
  companyId: string,
  from: OrderStatus,
  to: OrderStatus,
  ctx: AuditContext,
  data: OrderTransitionData = {},
): Promise<void> {
  await assertValidOrderTransition(from, to, entityId, ctx);
  await prisma.order.update({ where: { id: entityId, companyId }, data: { ...data, status: to } });
}

/** Transaction-bound variant used when stock, lines and the status must commit atomically. */
export async function transitionOrderStatusInTransaction(
  tx: Prisma.TransactionClient,
  entityId: string,
  companyId: string,
  from: OrderStatus,
  to: OrderStatus,
  ctx: AuditContext,
  data: OrderTransitionData = {},
): Promise<void> {
  await assertValidOrderTransition(from, to, entityId, ctx);
  await tx.order.update({ where: { id: entityId, companyId }, data: { ...data, status: to } });
}

// --- QcInspection -----------------------------------------------------
// Not a state machine: the Prisma model has no `.status` field, only a
// single `overallResult` ('PASS' | 'FAIL') computed once by
// `lib/qc-inspection.ts`'s `evaluateInspection` at creation time and never
// updated afterward - there is no later transition for this policy to
// police. Documented here (rather than silently having no sixth entity)
// so a reader auditing the six named in the Week 7 scope finds an explicit
// decision instead of a gap: this module exports the invariant that
// `overallResult` is write-once, so anything that ever tries to *update* an
// existing inspection's result should route through this assertion instead
// of a bare `prisma.qcInspection.update`.

export function assertInspectionResultImmutable(existingResult: string | null | undefined, entityId: string, traceId: string = newTraceId()): void {
  if (existingResult === null || existingResult === undefined) return;
  throw new InvalidTransitionError('QcInspection', existingResult, existingResult, traceId);
}
