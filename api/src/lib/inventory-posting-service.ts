// ADR-001 / Week 6: the canonical inventory posting service.
//
// Important correction to the Week 2 read of this codebase: `StockMovement`
// + `StockBalance` (via `routes/foundation.ts`'s old `postStockMovement`)
// looked like the live canonical path, but that file was never mounted from
// `src/index.ts` - dead code, a "sketch" per its own file header (Week 8
// retired the file entirely once its one unique surface, Branch management,
// was migrated to `routes/branches.ts` - see docs/route-ownership-matrix.md).
// The actually-live balance table, written from eight places today (ADR-001's
// baseline), is `StockLedger`. A canonical posting service that writes to an
// unused table has no real value; this one posts to the table that is
// actually live.
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
import { randomUUID } from 'node:crypto';
import type { Prisma, StockMovement } from '@prisma/client';
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';

export const NEGATIVE_STOCK_POLICIES = ['BLOCK', 'WARN', 'ALLOW'] as const;
export type NegativeStockPolicy = (typeof NEGATIVE_STOCK_POLICIES)[number];

export class NegativeStockBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NegativeStockBlockedError';
  }
}

export class MovementNotFoundError extends Error {
  constructor(movementId: string) {
    super(`Movement ${movementId} was not found.`);
    this.name = 'MovementNotFoundError';
  }
}

export class AlreadyReversedError extends Error {
  constructor(movementId: string) {
    super(`Movement ${movementId} has already been reversed.`);
    this.name = 'AlreadyReversedError';
  }
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
  balance: { onHand: number };
};

async function resolveNegativeStockPolicy(locationId: string): Promise<NegativeStockPolicy> {
  const config = await prisma.workflowConfiguration.findFirst({
    where: { type: 'STOCK_POSTING', scopeId: locationId },
  });
  const value = config?.negativeStockRule;
  return (NEGATIVE_STOCK_POLICIES as readonly string[]).includes(value ?? '')
    ? (value as NegativeStockPolicy)
    : 'BLOCK';
}

async function findByIdempotencyKey(companyId: string, idempotencyKey: string): Promise<StockMovement | null> {
  return prisma.stockMovement.findFirst({ where: { companyId, idempotencyKey } });
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

/**
 * Posts one inventory movement. Within a single DB transaction: applies the
 * balance to StockLedger with optimistic-lock retry (so two concurrent
 * posts to the same item/lot/location cannot silently overwrite each
 * other's write), inserts the immutable StockMovement journal row, writes
 * an audit log entry and enqueues a durable outbox event - all four commit
 * together or not at all.
 */
export async function postInventoryMovement(cmd: PostMovementCommand): Promise<PostMovementResult> {
  if (!cmd.idempotencyKey) throw new Error('idempotencyKey is required to post an inventory movement.');
  if (!cmd.lotId) throw new Error('lotId is required to post an inventory movement (StockLedger is lot-tracked).');
  if (!cmd.reason && !cmd.sourceDocument) throw new Error('A reason or sourceDocument is required to post an inventory movement.');

  const existing = await findByIdempotencyKey(cmd.tenant.companyId, cmd.idempotencyKey);
  if (existing) return { duplicate: true, movement: existing, balance: { onHand: existing.afterBalance } };

  const policy = await resolveNegativeStockPolicy(cmd.locationId);
  const correlationId = cmd.correlationId ?? randomUUID();

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const current = await prisma.stockLedger.findUnique({
      where: { itemId_lotId_locationId: { itemId: cmd.itemId, lotId: cmd.lotId, locationId: cmd.locationId } },
    }).catch(() => null);

    const beforeBalance = current?.onHand ?? 0;
    const afterBalance = beforeBalance + cmd.qtyDelta;

    if (afterBalance < 0) {
      if (policy === 'BLOCK') {
        throw new NegativeStockBlockedError(
          `Movement blocked: posting ${cmd.qtyDelta} would take stock to ${afterBalance} for item ${cmd.itemId}.`,
        );
      }
      if (policy === 'WARN') {
        console.warn(`Negative stock warning: item ${cmd.itemId} location ${cmd.locationId} -> ${afterBalance}`);
      }
    }

    try {
      const movement = await prisma.$transaction(async (tx) => {
        const created = await tx.stockMovement.create({
          data: {
            itemId: cmd.itemId,
            lotId: cmd.lotId,
            locationId: cmd.locationId,
            movementType: cmd.movementType as never,
            qtyDelta: cmd.qtyDelta,
            beforeBalance,
            afterBalance,
            sourceDocument: cmd.sourceDocument,
            sourceLineId: cmd.sourceLineId,
            actor: cmd.tenant.userId,
            timestamp: new Date(),
            correlationId,
            reason: cmd.reason,
            metadata: cmd.metadata as never,
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
          if (count === 0) throw new Error('OPTIMISTIC_LOCK_LOST');
        } else {
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
            id: randomUUID(),
            actorId: cmd.tenant.userId,
            actorRole: cmd.tenant.role,
            action: 'STOCK_MOVEMENT_POSTED',
            entityType: 'StockMovement',
            entityId: created.id,
            correlationId,
            reason: cmd.reason,
            tenantId: cmd.tenant.tenantId,
            metadata: { movementType: cmd.movementType, qtyDelta: cmd.qtyDelta, itemId: cmd.itemId, locationId: cmd.locationId } as never,
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
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Another concurrent request with the identical idempotency key won
        // the race - this is the duplicate-retry case, not a real conflict.
        const winner = await findByIdempotencyKey(cmd.tenant.companyId, cmd.idempotencyKey);
        if (winner) return { duplicate: true, movement: winner, balance: { onHand: winner.afterBalance } };
      }
      // OPTIMISTIC_LOCK_LOST or any other transient failure: retry the
      // outer loop from a fresh balance read.
      continue;
    }
  }

  throw new Error('Failed to post stock movement after concurrent-write retries; please retry the request.');
}

/**
 * Same posting, but joined to a transaction the caller already owns, so the
 * journal row, the StockLedger projection, the audit entry and the outbox row
 * commit or roll back *together with the caller's business state* (a PO
 * receipt, a transfer receipt...). Concurrency is handled by the database: the
 * ledger change is one atomic `onHand + delta` upsert, so there is no
 * read-then-write gap and no retry loop to nest inside an outer transaction.
 *
 * Failures (negative stock under BLOCK, a duplicate idempotency key racing in)
 * throw, which rolls the caller's whole transaction back - a caller that wants
 * duplicate-tolerant behaviour checks `findMovementByIdempotencyKey` first.
 */
export async function postInventoryMovementInTransaction(
  tx: Prisma.TransactionClient,
  cmd: PostMovementCommand,
): Promise<PostMovementResult> {
  if (!cmd.idempotencyKey) throw new Error('idempotencyKey is required to post an inventory movement.');
  if (!cmd.lotId) throw new Error('lotId is required to post an inventory movement (StockLedger is lot-tracked).');
  if (!cmd.reason && !cmd.sourceDocument) throw new Error('A reason or sourceDocument is required to post an inventory movement.');

  const existing = await tx.stockMovement.findFirst({ where: { companyId: cmd.tenant.companyId, idempotencyKey: cmd.idempotencyKey } });
  if (existing) return { duplicate: true, movement: existing, balance: { onHand: existing.afterBalance } };

  const config = await tx.workflowConfiguration.findFirst({ where: { type: 'STOCK_POSTING', scopeId: cmd.locationId } });
  const policy: NegativeStockPolicy = (NEGATIVE_STOCK_POLICIES as readonly string[]).includes(config?.negativeStockRule ?? '')
    ? (config!.negativeStockRule as NegativeStockPolicy)
    : 'BLOCK';

  const ledger = await tx.stockLedger.upsert({
    where: { itemId_lotId_locationId: { itemId: cmd.itemId, lotId: cmd.lotId, locationId: cmd.locationId } },
    update: { onHand: { increment: cmd.qtyDelta }, version: { increment: 1 } },
    create: {
      itemId: cmd.itemId, lotId: cmd.lotId, locationId: cmd.locationId, onHand: cmd.qtyDelta, version: 1,
      companyId: cmd.tenant.companyId, tenantId: cmd.tenant.tenantId,
    },
  });
  const afterBalance = ledger.onHand;
  const beforeBalance = afterBalance - cmd.qtyDelta;
  if (afterBalance < 0) {
    if (policy === 'BLOCK') {
      throw new NegativeStockBlockedError(
        `Movement blocked: posting ${cmd.qtyDelta} would take stock to ${afterBalance} for item ${cmd.itemId}.`,
      );
    }
    if (policy === 'WARN') console.warn(`Negative stock warning: item ${cmd.itemId} location ${cmd.locationId} -> ${afterBalance}`);
  }

  const correlationId = cmd.correlationId ?? randomUUID();
  const movement = await tx.stockMovement.create({
    data: {
      itemId: cmd.itemId, lotId: cmd.lotId, locationId: cmd.locationId,
      movementType: cmd.movementType as never, qtyDelta: cmd.qtyDelta, beforeBalance, afterBalance,
      sourceDocument: cmd.sourceDocument, sourceLineId: cmd.sourceLineId, actor: cmd.tenant.userId,
      timestamp: new Date(), correlationId, reason: cmd.reason, metadata: cmd.metadata as never,
      companyId: cmd.tenant.companyId, tenantId: cmd.tenant.tenantId, idempotencyKey: cmd.idempotencyKey,
    },
  });
  await tx.auditLog.create({
    data: {
      id: randomUUID(), actorId: cmd.tenant.userId, actorRole: cmd.tenant.role, action: 'STOCK_MOVEMENT_POSTED',
      entityType: 'StockMovement', entityId: movement.id, correlationId, reason: cmd.reason, tenantId: cmd.tenant.tenantId,
      metadata: { movementType: cmd.movementType, qtyDelta: cmd.qtyDelta, itemId: cmd.itemId, locationId: cmd.locationId } as never,
    },
  });
  await tx.domainEventOutbox.create({
    data: { topic: 'stock.changed', companyId: cmd.tenant.companyId, locationIds: [cmd.locationId], actorId: cmd.tenant.userId },
  });
  return { duplicate: false, movement, balance: { onHand: afterBalance } };
}

/**
 * Reversal is a compensating movement, never an edit to the original: the
 * original StockMovement row is read-only from here on. The idempotency key
 * for the reversal is derived deterministically from the original movement
 * id, so retrying a reversal request is itself idempotent through the same
 * mechanism as any other post.
 */
export async function reverseInventoryMovement(
  tenant: TenantContext,
  originalMovementId: string,
  reason: string,
): Promise<PostMovementResult> {
  const original = await prisma.stockMovement.findFirst({ where: { id: originalMovementId, companyId: tenant.companyId } });
  if (!original) throw new MovementNotFoundError(originalMovementId);
  if (!original.lotId) throw new Error(`Movement ${originalMovementId} has no lotId and cannot be reversed through StockLedger posting.`);

  const alreadyReversed = await prisma.stockMovement.findFirst({
    where: { companyId: tenant.companyId, metadata: { path: ['reversalOf'], equals: original.id } },
  }).catch(() => null);
  if (alreadyReversed) throw new AlreadyReversedError(originalMovementId);

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
