import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';

export type ReversibleMovement = {
  id: string;
  itemId: string;
  lotId: string | null;
  locationId: string;
  qtyDelta: number;
  movementType: string;
};

export type ReversalPlanLine = {
  itemId: string;
  lotId: string;
  locationId: string;
  qtyDelta: number;
  sourceMovementIds: string[];
};

export function buildReversalPlan(movements: ReversibleMovement[]): ReversalPlanLine[] {
  const grouped = new Map<string, ReversalPlanLine>();
  for (const movement of movements) {
    if (!movement.lotId || !Number.isFinite(Number(movement.qtyDelta))) continue;
    const key = `${movement.itemId}|${movement.lotId}|${movement.locationId}`;
    const line = grouped.get(key) ?? {
      itemId: movement.itemId, lotId: movement.lotId, locationId: movement.locationId,
      qtyDelta: 0, sourceMovementIds: [],
    };
    line.qtyDelta -= Number(movement.qtyDelta);
    line.sourceMovementIds.push(movement.id);
    grouped.set(key, line);
  }
  return [...grouped.values()].filter((line) => Math.abs(line.qtyDelta) > 1e-8);
}

export function buildOpeningSnapshotReversalPlan(
  snapshots: Array<{ id: string; itemId: string; lotId: string; locationId: string; qty: number }>,
): ReversalPlanLine[] {
  return snapshots
    .filter((row) => row.lotId && Number.isFinite(Number(row.qty)) && Math.abs(Number(row.qty)) > 1e-8)
    .map((row) => ({
      itemId: row.itemId,
      lotId: row.lotId,
      locationId: row.locationId,
      qtyDelta: -Number(row.qty),
      sourceMovementIds: [row.id],
    }));
}

export async function listImportBatches(limit = 100) {
  if (!databaseEnabled) {
    const { listStoredBatches } = await import('./import-batch-store.js');
    return listStoredBatches(limit);
  }
  return prisma.importBatch.findMany({
    orderBy: { importedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 250),
    select: {
      id: true, type: true, fileName: true, importedAt: true, totalRows: true,
      validRows: true, invalidRows: true, duplicateRows: true, status: true,
      branchId: true, metadata: true,
    },
  });
}

export async function reverseImportBatch(input: {
  batchId: string;
  actorId: string;
  reason: string;
}): Promise<{ duplicate: boolean; reversalBatchId?: string; reversedMovements: number; plan: ReversalPlanLine[] }> {
  if (!databaseEnabled) throw new Error('Import reversal requires database persistence.');
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error('A reversal reason of at least 5 characters is required.');

  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({
      where: { id: input.batchId },
      include: { inventoryMovements: true, openingSnapshots: true },
    });
    if (!batch) throw new Error('Import batch was not found.');
    if (batch.status === 'REVERSED') return { duplicate: true, reversedMovements: 0, plan: [] };
    if (batch.status !== 'POSTED') throw new Error(`Only POSTED imports can be reversed; this batch is ${batch.status}.`);

    const fromMovements = buildReversalPlan(batch.inventoryMovements);
    const fromSnapshots = buildOpeningSnapshotReversalPlan(batch.openingSnapshots);
    const plan = fromMovements.length ? fromMovements : fromSnapshots;
    if (!plan.length) {
      throw new Error('This import has no lot stock rows to reverse. Re-import is still possible after an admin clears leftover ledger rows.');
    }

    const claimed = await tx.importBatch.updateMany({
      where: { id: batch.id, status: 'POSTED' },
      data: { status: 'REVERSING' },
    });
    if (claimed.count !== 1) throw new Error('Import is already being reversed.');

    if (fromMovements.length) {
      for (const line of plan) {
        const ledger = await tx.stockLedger.findUnique({
          where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
        });
        const after = Number(ledger?.onHand ?? 0) + line.qtyDelta;
        if (after < -1e-8) {
          throw new Error(`Cannot reverse: lot ${line.lotId} at location ${line.locationId} would become negative (${after}).`);
        }
      }
    }

    const reversalBatchId = `reversal-${randomUUID()}`;
    await tx.importBatch.create({
      data: {
        id: reversalBatchId,
        type: `${batch.type}_REVERSAL`,
        fileName: `Reversal of ${batch.fileName}`,
        sourceFormat: 'system-reversal',
        importedById: input.actorId,
        totalRows: plan.length,
        validRows: plan.length,
        invalidRows: 0,
        duplicateRows: 0,
        status: 'POSTED',
        branchId: batch.branchId,
        metadata: { originalBatchId: batch.id, reason, source: fromMovements.length ? 'inventoryMovements' : 'openingSnapshots' } as Prisma.InputJsonValue,
      },
    });

    for (let offset = 0; offset < plan.length; offset += 400) {
      const chunk = plan.slice(offset, offset + 400);
      await tx.inventoryMovement.createMany({
        data: chunk.map((line) => ({
          id: `movement-${randomUUID()}`,
          dedupeKey: `reversal:${batch.id}:${line.itemId}:${line.lotId}:${line.locationId}:${line.sourceMovementIds[0] ?? offset}`,
          itemId: line.itemId,
          lotId: line.lotId,
          locationId: line.locationId,
          movementType: `${batch.type}_REVERSAL`,
          qtyDelta: line.qtyDelta,
          transactionAt: new Date(),
          sourceType: 'IMPORT_REVERSAL',
          sourceReference: batch.id,
          importBatchId: reversalBatchId,
          createdById: input.actorId,
          metadata: { sourceIds: line.sourceMovementIds, reason } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE "StockLedger" AS sl
        SET "onHand" = GREATEST(0, sl."onHand" + d."qtyDelta"), version = sl.version + 1, "lastUpdatedAt" = NOW()
        FROM (
          VALUES ${Prisma.join(chunk.map((line) => Prisma.sql`(${line.itemId}, ${line.lotId}, ${line.locationId}, ${line.qtyDelta}::double precision)`), ', ')}
        ) AS d("itemId", "lotId", "locationId", "qtyDelta")
        WHERE sl."itemId" = d."itemId" AND sl."lotId" = d."lotId" AND sl."locationId" = d."locationId"
      `);
    }
    await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: 'REVERSED', metadata: { ...(batch.metadata && typeof batch.metadata === 'object' ? batch.metadata as object : {}), reversalBatchId, reversalReason: reason } as Prisma.InputJsonValue },
    });
    return { duplicate: false, reversalBatchId, reversedMovements: plan.length, plan };
  }, { maxWait: 10_000, timeout: 120_000 });
}
