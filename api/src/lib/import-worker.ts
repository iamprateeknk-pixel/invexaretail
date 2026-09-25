// Week 11: the durable background worker that actually drains
// QUEUED_FOR_COMMIT/COMMITTING import batches, so the HTTP request that
// triggers a commit returns immediately instead of blocking on
// potentially 5,000+ row's worth of InventoryPostingService calls. Same
// poll-loop shape as lib/outbox-worker.ts (Week 7): claim work, do a
// bounded amount of it, come back later - crash-safe because each unit of
// work (one row) is itself idempotent.
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { commitImportBatchChunk } from './import-commit-service.js';

export type ImportWorkerTickResult = { batchesProcessed: number; rowsProcessed: number };

/**
 * One tick: claims every batch currently queued or mid-commit and advances
 * each by one chunk. Multiple batches (from different tenants) make
 * progress in the same tick rather than one batch hogging the worker.
 */
export async function drainImportCommitsOnce(chunkSize = 500): Promise<ImportWorkerTickResult> {
  if (!databaseEnabled) return { batchesProcessed: 0, rowsProcessed: 0 };
  const pending = await prisma.importBatch.findMany({
    where: { status: { in: ['QUEUED_FOR_COMMIT', 'COMMITTING'] } },
    select: { id: true, companyId: true },
  });

  let rowsProcessed = 0;
  for (const { id, companyId } of pending) {
    const result = await commitImportBatchChunk(companyId, id, chunkSize);
    rowsProcessed += result.processed;
  }
  return { batchesProcessed: pending.length, rowsProcessed };
}

let pollTimer: NodeJS.Timeout | null = null;

export function startImportWorker(intervalMs = 2000): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    drainImportCommitsOnce().catch((error) => console.error('[import-worker] drain failed', error));
  }, intervalMs);
  pollTimer.unref?.();
}

export function stopImportWorker(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
