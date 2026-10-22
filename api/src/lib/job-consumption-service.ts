// Plan P1-STOCK-001: consuming inventory against a job is a stock-changing command,
// so it runs as ONE database transaction on the canonical posting service, with the
// database - not a process-memory snapshot - deciding what is available.
//
// Before: the route allocated lots from the in-memory item/stock mirror, derived the
// idempotency key from `line.issuedQty` read *before* the transaction, and nudged the
// memory mirror afterwards. Two consequences:
//   * two concurrent requests read the same issuedQty, got the SAME key, and the
//     second movement was silently skipped as a "duplicate" while the line counters
//     still went up twice (recorded usage > stock actually removed);
//   * a client retry after a timeout got a DIFFERENT key (issuedQty had moved) and
//     consumed the stock a second time.
// Now: the caller supplies the idempotency key (`requestId`, created once per user
// action), the job line is locked for the duration, lots and balances are read in the
// same transaction, and counters move only when a movement was actually created.
import { prisma } from './db.js';
import type { Prisma } from '@prisma/client';
import { postInventoryMovementInTransaction } from './inventory-posting-service.js';
import { allocateLots, type AllocationStrategy, type FefoLot } from './warehouse-workflow.js';
import type { TenantContext } from './tenant-context.js';

export class JobConsumeError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'JobConsumeError';
  }
}

export type JobConsumeInput = {
  tenant: TenantContext;
  jobId: string;
  lineId: string;
  quantity: number;
  lotId?: string;
  /** Caller-supplied idempotency key, created once per user action and reused on every retry. */
  requestId: string;
  strategy: AllocationStrategy;
  /** Authorization hook for the job's location (kept in the route, which owns role/location rules). */
  canAccessLocation: (locationId: string) => boolean;
};

export type JobConsumeResult = {
  duplicate: boolean;
  locationId: string;
  itemId: string;
  allocations: Array<{ lotId: string; lotNo: string; quantity: number }>;
};

const keyFor = (lineId: string, requestId: string, lotId: string) => `job-consume:${lineId}:${requestId}:${lotId}`;

export async function consumeJobLine(input: JobConsumeInput): Promise<JobConsumeResult> {
  const { tenant, jobId, lineId, quantity, requestId } = input;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new JobConsumeError('quantity must be a positive whole number.', 400);
  if (!requestId) throw new JobConsumeError('requestId is required (a key created once per consume action).', 400);

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, companyId: tenant.companyId }, select: { id: true, status: true, locationId: true } });
    if (!job) throw new JobConsumeError('Job not found.', 404);
    if (!input.canAccessLocation(job.locationId)) throw new JobConsumeError('Location access denied.', 403);
    // Serialize concurrent consumes of the same line for the rest of this transaction.
    await lockLine(tx, lineId);
    const line = await tx.jobLine.findFirst({ where: { id: lineId, jobId: job.id } });
    if (!line) throw new JobConsumeError('Job line not found.', 404);

    // Replay: this request already ran. Return what it did; never run it twice.
    const prior = await tx.stockMovement.findMany({
      where: { companyId: tenant.companyId, sourceLineId: line.id, idempotencyKey: { startsWith: `job-consume:${line.id}:${requestId}:` } },
      include: { lot: { select: { lotNo: true } } },
    });
    if (prior.length) {
      return {
        duplicate: true, locationId: job.locationId, itemId: line.itemId,
        allocations: prior.map((movement) => ({ lotId: movement.lotId, lotNo: movement.lot?.lotNo ?? movement.lotId, quantity: -Number(movement.qtyDelta) })),
      };
    }

    if (job.status !== 'ACTIVE') throw new JobConsumeError('Start the job before consuming inventory.', 409);

    // What is actually sellable here, now: on hand minus what is reserved or quarantined.
    const ledger = await tx.stockLedger.findMany({
      where: { itemId: line.itemId, locationId: job.locationId, companyId: tenant.companyId },
      include: { lot: true },
    });
    const candidates: FefoLot[] = ledger
      .filter((row) => !input.lotId || row.lotId === input.lotId)
      .map((row) => ({
        lotId: row.lotId,
        lotNo: row.lot.lotNo,
        expiryDate: row.lot.expiryDate ? row.lot.expiryDate.toISOString() : null,
        manufacturedAt: row.lot.manufacturedAt ? row.lot.manufacturedAt.toISOString() : null,
        createdAt: row.lot.createdAt.toISOString(),
        available: Math.max(0, Number(row.onHand) - Number(row.reserved) - Number(row.quarantine)),
        status: (row.lot.status ?? 'AVAILABLE') as FefoLot['status'],
      }));
    const allocation = allocateLots(candidates, quantity, input.strategy);
    if (allocation.shortage > 1e-8) {
      throw new JobConsumeError(`Only ${quantity - allocation.shortage} units are available to consume.`, 409);
    }

    let created = 0;
    for (const pick of allocation.allocations) {
      const { duplicate } = await postInventoryMovementInTransaction(tx, {
        tenant, itemId: line.itemId, lotId: pick.lotId, locationId: job.locationId,
        movementType: 'ADJUSTMENT', qtyDelta: -pick.quantity,
        idempotencyKey: keyFor(line.id, requestId, pick.lotId),
        reason: 'Job consumption', sourceDocument: job.id, sourceLineId: line.id, correlationId: job.id,
      });
      if (!duplicate) created += 1;
    }
    // Counters move only with real movements, in the same transaction.
    if (created > 0) {
      await tx.jobLine.update({ where: { id: line.id }, data: { issuedQty: { increment: quantity }, usedQty: { increment: quantity } } });
    }
    return {
      duplicate: created === 0, locationId: job.locationId, itemId: line.itemId,
      allocations: allocation.allocations.map((pick) => ({ lotId: pick.lotId, lotNo: pick.lotNo, quantity: pick.quantity })),
    };
  }, { timeout: 15_000 });
}

async function lockLine(tx: Prisma.TransactionClient, lineId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "JobLine" WHERE "id" = ${lineId} FOR UPDATE`;
}
