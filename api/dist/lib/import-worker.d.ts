export type ImportWorkerTickResult = {
    batchesProcessed: number;
    rowsProcessed: number;
};
/**
 * One tick: claims every batch currently queued or mid-commit and advances
 * each by one chunk. Multiple batches (from different tenants) make
 * progress in the same tick rather than one batch hogging the worker.
 */
export declare function drainImportCommitsOnce(chunkSize?: number): Promise<ImportWorkerTickResult>;
export declare function startImportWorker(intervalMs?: number): void;
export declare function stopImportWorker(): void;
