"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drainImportCommitsOnce = drainImportCommitsOnce;
exports.startImportWorker = startImportWorker;
exports.stopImportWorker = stopImportWorker;
// Week 11: the durable background worker that actually drains
// QUEUED_FOR_COMMIT/COMMITTING import batches, so the HTTP request that
// triggers a commit returns immediately instead of blocking on
// potentially 5,000+ row's worth of InventoryPostingService calls. Same
// poll-loop shape as lib/outbox-worker.ts (Week 7): claim work, do a
// bounded amount of it, come back later - crash-safe because each unit of
// work (one row) is itself idempotent.
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
const import_commit_service_js_1 = require("./import-commit-service.js");
/**
 * One tick: claims every batch currently queued or mid-commit and advances
 * each by one chunk. Multiple batches (from different tenants) make
 * progress in the same tick rather than one batch hogging the worker.
 */
async function drainImportCommitsOnce(chunkSize = 500) {
    if (!persistence_js_1.databaseEnabled)
        return { batchesProcessed: 0, rowsProcessed: 0 };
    const pending = await db_js_1.prisma.importBatch.findMany({
        where: { status: { in: ['QUEUED_FOR_COMMIT', 'COMMITTING'] } },
        select: { id: true, companyId: true },
    });
    let rowsProcessed = 0;
    for (const { id, companyId } of pending) {
        const result = await (0, import_commit_service_js_1.commitImportBatchChunk)(companyId, id, chunkSize);
        rowsProcessed += result.processed;
    }
    return { batchesProcessed: pending.length, rowsProcessed };
}
let pollTimer = null;
function startImportWorker(intervalMs = 2000) {
    if (pollTimer)
        return;
    pollTimer = setInterval(() => {
        drainImportCommitsOnce().catch((error) => console.error('[import-worker] drain failed', error));
    }, intervalMs);
    pollTimer.unref?.();
}
function stopImportWorker() {
    if (pollTimer)
        clearInterval(pollTimer);
    pollTimer = null;
}
