import type { TenantContext } from './tenant-context.js';
import { type RawImportRow } from './import-row-validation.js';
import { type ImportType } from './import-business-rules.js';
export type { ImportType };
export declare class DuplicateFileError extends Error {
    readonly existingBatchId: string;
    constructor(existingBatchId: string);
}
export declare class BatchNotFoundError extends Error {
    constructor(batchId: string);
}
export declare class InvalidBatchStateError extends Error {
    constructor(batchId: string, expected: string[], actual: string);
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
export declare function createImportBatch(ctx: TenantContext, input: CreateImportBatchInput): Promise<{
    companyId: string;
    id: string;
    tenantId: string;
    status: string;
    type: string;
    fileName: string;
    sourceFormat: string;
    importedById: string;
    importedAt: Date;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    metadata: import("@prisma/client/runtime/client").JsonValue | null;
    branchId: string | null;
    fileHash: string | null;
    sourceDateFrom: Date | null;
    sourceDateTo: Date | null;
    checkpointRowNumber: number;
    commitPolicy: string;
    reversedAt: Date | null;
}>;
/**
 * Validates every row (resolve-only, no writes to Item/Lot/StockLedger) in
 * chunks, so a 5,000+ row file's validation pass never holds one giant
 * result set in memory. Safe to re-run on a DRAFT or already-VALIDATED
 * batch - validation has no side effects to double up on.
 */
export declare function validateImportBatch(ctx: TenantContext, batchId: string): Promise<{
    validRows: number;
    invalidRows: number;
}>;
/**
 * Moves a validated batch into the commit queue. For an ALL_OR_NOTHING
 * import type (opening stock), a batch with any invalid row is refused
 * outright here - FAILED, zero rows posted - rather than letting the
 * worker discover the problem after already posting some rows.
 */
export declare function queueImportBatchForCommit(ctx: TenantContext, batchId: string): Promise<void>;
export type CommitChunkResult = {
    done: boolean;
    processed: number;
};
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
export declare function commitImportBatchChunk(batchId: string, chunkSize?: number): Promise<CommitChunkResult>;
/** Runs commitImportBatchChunk to completion - the synchronous convenience wrapper tests and a worker's single tick both use. */
export declare function commitImportBatchToCompletion(batchId: string, chunkSize?: number): Promise<void>;
/**
 * Reverses every committed row's movement through
 * reverseInventoryMovement (Week 6) - an equal-and-opposite post, never an
 * edit to the original. Tolerates a row that was already reversed (a
 * retried/resumed reverse call), so calling this twice is itself safe.
 */
export declare function reverseImportBatch(ctx: TenantContext, batchId: string, reason: string): Promise<void>;
export type FailedRowExport = {
    rowNumber: number;
    field: string;
    code: string;
    message: string;
};
/** Every INVALID row's errors, flattened one error per line - the guide's downloadable "row, field, code and safe message" failure export. */
export declare function exportFailedRows(ctx: TenantContext, batchId: string): Promise<FailedRowExport[]>;
