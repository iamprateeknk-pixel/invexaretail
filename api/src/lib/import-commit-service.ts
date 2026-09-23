// Week 11: the staged import lifecycle - DRAFT -> VALIDATED ->
// QUEUED_FOR_COMMIT -> COMMITTING -> COMMITTED / PARTIALLY_COMMITTED /
// FAILED -> REVERSING -> REVERSED - as explicit states on ImportBatch,
// replacing the old single-transaction persistDailyMovementImport/
// persistOpeningStockImport path (lib/persistence.ts) for new imports.
// Every stock post and reversal goes through
// lib/inventory-posting-service.ts exclusively (Week 6's canonical
// service) - this module never touches StockLedger/StockMovement itself.
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';
import { postInventoryMovement, reverseInventoryMovement, NegativeStockBlockedError, AlreadyReversedError } from './inventory-posting-service.js';
import { validateImportRow, type RawImportRow, type RowError } from './import-row-validation.js';
import {
  resolveLotForItem,
  isLateMovement,
  advanceSyncCheckpoint,
  IMPORT_TYPE_POLICY,
  type ImportType,
} from './import-business-rules.js';

export type { ImportType };
import { findDuplicateBatch } from './import-checksum.js';

const MOVEMENT_TYPE_BY_IMPORT_TYPE: Record<ImportType, string> = {
  PURCHASE: 'PURCHASE_RECEIPT',
  SALES: 'SALES_DEDUCTION',
  SALES_RETURN: 'SALES_RETURN',
  OPENING_STOCK: 'OPENING_STOCK',
};

function signedQuantity(type: ImportType, quantity: number): number {
  // Purchases and returns add stock; sales remove it. Quantity is always
  // entered positive on the row - the sign is a business rule, not
  // something the uploader should have to get right.
  return type === 'SALES' ? -Math.abs(quantity) : Math.abs(quantity);
}

const ROW_CHUNK_SIZE = 500;

export class DuplicateFileError extends Error {
  constructor(public readonly existingBatchId: string) {
    super(`This file was already imported as batch ${existingBatchId}.`);
    this.name = 'DuplicateFileError';
  }
}

export class BatchNotFoundError extends Error {
  constructor(batchId: string) {
    super(`Import batch ${batchId} was not found.`);
    this.name = 'BatchNotFoundError';
  }
}

export class InvalidBatchStateError extends Error {
  constructor(batchId: string, expected: string[], actual: string) {
    super(`Import batch ${batchId} must be in state [${expected.join(', ')}] for this action, but is ${actual}.`);
    this.name = 'InvalidBatchStateError';
  }
}

export type CreateImportBatchInput = {
  type: ImportType;
  fileName: string;
  sourceFormat: string;
  fileChecksum: string;
  rows: RawImportRow[];
  importedById: string;
};

/**
 * Stages a new batch. Rejects a byte-identical re-upload (same checksum,
 * type, tenant) up front rather than creating a duplicate batch that would
 * later post duplicate movements - the guide's "file/content checksum...
 * idempotency" requirement, enforced before any row exists.
 */
export async function createImportBatch(ctx: TenantContext, input: CreateImportBatchInput) {
  const duplicate = await findDuplicateBatch(ctx.companyId, input.type, input.fileChecksum);
  if (duplicate) throw new DuplicateFileError(duplicate.id);

  const batchId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.importBatch.create({
      data: {
        id: batchId,
        type: input.type,
        fileName: input.fileName,
        sourceFormat: input.sourceFormat,
        importedById: input.importedById,
        totalRows: input.rows.length,
        validRows: 0,
        invalidRows: 0,
        status: 'DRAFT',
        fileHash: input.fileChecksum,
        companyId: ctx.companyId,
        commitPolicy: IMPORT_TYPE_POLICY[input.type],
      },
    });
    for (let start = 0; start < input.rows.length; start += ROW_CHUNK_SIZE) {
      const chunk = input.rows.slice(start, start + ROW_CHUNK_SIZE);
      await tx.importRow.createMany({
        data: chunk.map((raw, offset) => ({
          importBatchId: batchId,
          rowNumber: start + offset + 1,
          rawData: raw as never,
          status: 'DRAFT',
          companyId: ctx.companyId,
        })),
      });
    }
  });
  return prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
}

async function requireBatch(ctx: TenantContext, batchId: string) {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, companyId: ctx.companyId } });
  if (!batch) throw new BatchNotFoundError(batchId);
  return batch;
}

function assertStatus(batch: { id: string; status: string }, expected: string[]) {
  if (!expected.includes(batch.status)) throw new InvalidBatchStateError(batch.id, expected, batch.status);
}

/**
 * Validates every row (resolve-only, no writes to Item/Lot/StockLedger) in
 * chunks, so a 5,000+ row file's validation pass never holds one giant
 * result set in memory. Safe to re-run on a DRAFT or already-VALIDATED
 * batch - validation has no side effects to double up on.
 */
export async function validateImportBatch(ctx: TenantContext, batchId: string): Promise<{ validRows: number; invalidRows: number }> {
  const batch = await requireBatch(ctx, batchId);
  assertStatus(batch, ['DRAFT', 'VALIDATED']);

  let validCount = 0;
  let invalidCount = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.importRow.findMany({
      where: { importBatchId: batchId },
      orderBy: { id: 'asc' },
      take: ROW_CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const result = await validateImportRow(ctx, batch.type as ImportType, row.rawData as RawImportRow);
      if (result.ok === false) {
        invalidCount += 1;
        await prisma.importRow.update({
          where: { id: row.id },
          data: { status: 'INVALID', errors: result.errors as never },
        });
      } else {
        validCount += 1;
        await prisma.importRow.update({
          where: { id: row.id },
          data: { status: 'VALID', mappedData: result.mapped as never, errors: undefined, warnings: result.warnings as never },
        });
      }
    }
    cursor = rows[rows.length - 1].id;
  }

  await prisma.importBatch.update({ where: { id: batchId }, data: { validRows: validCount, invalidRows: invalidCount, status: 'VALIDATED' } });
  return { validRows: validCount, invalidRows: invalidCount };
}

/**
 * Moves a validated batch into the commit queue. For an ALL_OR_NOTHING
 * import type (opening stock), a batch with any invalid row is refused
 * outright here - FAILED, zero rows posted - rather than letting the
 * worker discover the problem after already posting some rows.
 */
export async function queueImportBatchForCommit(ctx: TenantContext, batchId: string): Promise<void> {
  const batch = await requireBatch(ctx, batchId);
  assertStatus(batch, ['VALIDATED']);

  if (batch.commitPolicy === 'ALL_OR_NOTHING' && batch.invalidRows > 0) {
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'FAILED' } });
    return;
  }
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'QUEUED_FOR_COMMIT' } });
}

export type CommitChunkResult = { done: boolean; processed: number };

/**
 * Commits up to one chunk of VALID rows past the batch's durable
 * checkpoint. Designed to be called repeatedly (by a worker loop, not
 * inline in an HTTP request) until `done: true` - each call is a bounded
 * amount of work, so a 5,000+ row file never blocks a request thread, and
 * a crash between calls loses at most the in-flight chunk: every row
 * already committed is still committed (idempotency key), and the
 * checkpoint means an already-committed row's chunk is never re-scanned
 * from the start.
 */
export async function commitImportBatchChunk(batchId: string, chunkSize = ROW_CHUNK_SIZE): Promise<CommitChunkResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (!['QUEUED_FOR_COMMIT', 'COMMITTING'].includes(batch.status)) return { done: true, processed: 0 };
  if (batch.status === 'QUEUED_FOR_COMMIT') {
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMITTING' } });
  }

  const importer = await prisma.user.findUniqueOrThrow({ where: { id: batch.importedById } });
  const ctx: TenantContext = { companyId: batch.companyId, tenantId: 'tenant-invexa', userId: importer.id, role: importer.role as TenantContext['role'] };

  const rows = await prisma.importRow.findMany({
    where: { importBatchId: batchId, status: 'VALID', rowNumber: { gt: batch.checkpointRowNumber } },
    orderBy: { rowNumber: 'asc' },
    take: chunkSize,
  });

  if (!rows.length) {
    const remainingInvalid = await prisma.importRow.count({ where: { importBatchId: batchId, status: 'INVALID' } });
    const finalStatus = remainingInvalid > 0 ? 'PARTIALLY_COMMITTED' : 'COMMITTED';
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: finalStatus, invalidRows: remainingInvalid } });
    return { done: true, processed: 0 };
  }

  const movementType = MOVEMENT_TYPE_BY_IMPORT_TYPE[batch.type as ImportType];
  for (const row of rows) {
    const mapped = row.mappedData as { itemId: string; lotNo: string; quantity: number; locationId: string; transactionAt: string };
    try {
      const lot = await resolveLotForItem(mapped.itemId, mapped.lotNo);
      const late = await isLateMovement(mapped.locationId, batch.type, new Date(mapped.transactionAt));

      const result = await postInventoryMovement({
        tenant: ctx,
        itemId: mapped.itemId,
        lotId: lot.id,
        locationId: mapped.locationId,
        movementType,
        qtyDelta: signedQuantity(batch.type as ImportType, mapped.quantity),
        idempotencyKey: `import:${batchId}:${row.rowNumber}`,
        sourceDocument: batch.fileName,
        sourceLineId: row.id,
        reason: `${batch.type} import row ${row.rowNumber}`,
      });

      await prisma.importRow.update({
        where: { id: row.id },
        data: {
          status: 'COMMITTED',
          movementId: result.movement.id,
          processedAt: new Date(),
          warnings: late ? ([{ field: 'transactionAt', code: 'LATE_MOVEMENT', message: 'This transaction is dated before the location\'s last sync checkpoint.' }] as never) : undefined,
        },
      });
      if (!late) await advanceSyncCheckpoint(mapped.locationId, batch.type, new Date(mapped.transactionAt), batchId);
    } catch (error) {
      // A row that validated structurally can still fail at commit time -
      // most commonly a negative-stock block discovered only once real
      // concurrent stock levels are checked. This is the "partial failure"
      // the guide names: the row becomes INVALID (visible in the failure
      // export) and every other row in the chunk keeps going.
      const message = error instanceof NegativeStockBlockedError ? error.message : error instanceof Error ? error.message : String(error);
      const code = error instanceof NegativeStockBlockedError ? 'INSUFFICIENT_STOCK' : 'COMMIT_FAILED';
      await prisma.importRow.update({
        where: { id: row.id },
        data: { status: 'INVALID', errors: [{ field: 'quantity', code, message }] as never },
      });
    }
    await prisma.importBatch.update({ where: { id: batchId }, data: { checkpointRowNumber: row.rowNumber } });
  }

  return { done: false, processed: rows.length };
}

/** Runs commitImportBatchChunk to completion - the synchronous convenience wrapper tests and a worker's single tick both use. */
export async function commitImportBatchToCompletion(batchId: string, chunkSize = ROW_CHUNK_SIZE): Promise<void> {
  for (;;) {
    const result = await commitImportBatchChunk(batchId, chunkSize);
    if (result.done) return;
  }
}

/**
 * Reverses every committed row's movement through
 * reverseInventoryMovement (Week 6) - an equal-and-opposite post, never an
 * edit to the original. Tolerates a row that was already reversed (a
 * retried/resumed reverse call), so calling this twice is itself safe.
 */
export async function reverseImportBatch(ctx: TenantContext, batchId: string, reason: string): Promise<void> {
  const batch = await requireBatch(ctx, batchId);
  assertStatus(batch, ['COMMITTED', 'PARTIALLY_COMMITTED', 'REVERSING']);
  if (batch.status !== 'REVERSING') {
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'REVERSING' } });
  }

  const rows = await prisma.importRow.findMany({
    where: { importBatchId: batchId, status: 'COMMITTED', movementId: { not: null } },
    orderBy: { rowNumber: 'asc' },
  });

  for (const row of rows) {
    try {
      await reverseInventoryMovement(ctx, row.movementId!, reason);
      await prisma.importRow.update({ where: { id: row.id }, data: { status: 'REVERSED' } });
    } catch (error) {
      if (error instanceof AlreadyReversedError) {
        await prisma.importRow.update({ where: { id: row.id }, data: { status: 'REVERSED' } });
        continue;
      }
      throw error;
    }
  }

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'REVERSED', reversedAt: new Date() } });
}

export type FailedRowExport = { rowNumber: number; field: string; code: string; message: string };

/** Every INVALID row's errors, flattened one error per line - the guide's downloadable "row, field, code and safe message" failure export. */
export async function exportFailedRows(ctx: TenantContext, batchId: string): Promise<FailedRowExport[]> {
  await requireBatch(ctx, batchId);
  const rows = await prisma.importRow.findMany({ where: { importBatchId: batchId, status: 'INVALID' }, orderBy: { rowNumber: 'asc' } });
  const out: FailedRowExport[] = [];
  for (const row of rows) {
    const errors = (row.errors as RowError[] | null) ?? [];
    for (const error of errors) out.push({ rowNumber: row.rowNumber, field: error.field, code: error.code, message: error.message });
  }
  return out;
}
