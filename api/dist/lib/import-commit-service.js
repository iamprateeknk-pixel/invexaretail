"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidBatchStateError = exports.BatchNotFoundError = exports.DuplicateFileError = void 0;
exports.createImportBatch = createImportBatch;
exports.validateImportBatch = validateImportBatch;
exports.queueImportBatchForCommit = queueImportBatchForCommit;
exports.commitImportBatchChunk = commitImportBatchChunk;
exports.commitImportBatchToCompletion = commitImportBatchToCompletion;
exports.reverseImportBatch = reverseImportBatch;
exports.exportFailedRows = exportFailedRows;
// Week 11: the staged import lifecycle - DRAFT -> VALIDATED ->
// QUEUED_FOR_COMMIT -> COMMITTING -> COMMITTED / PARTIALLY_COMMITTED /
// FAILED -> REVERSING -> REVERSED - as explicit states on ImportBatch,
// replacing the old single-transaction persistDailyMovementImport/
// persistOpeningStockImport path (lib/persistence.ts) for new imports.
// Every stock post and reversal goes through
// lib/inventory-posting-service.ts exclusively (Week 6's canonical
// service) - this module never touches StockLedger/StockMovement itself.
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const inventory_posting_service_js_1 = require("./inventory-posting-service.js");
const import_row_validation_js_1 = require("./import-row-validation.js");
const import_business_rules_js_1 = require("./import-business-rules.js");
const import_checksum_js_1 = require("./import-checksum.js");
const MOVEMENT_TYPE_BY_IMPORT_TYPE = {
    PURCHASE: 'PURCHASE_RECEIPT',
    SALES: 'SALES_DEDUCTION',
    SALES_RETURN: 'SALES_RETURN',
    OPENING_STOCK: 'OPENING_STOCK',
};
function signedQuantity(type, quantity) {
    // Purchases and returns add stock; sales remove it. Quantity is always
    // entered positive on the row - the sign is a business rule, not
    // something the uploader should have to get right.
    return type === 'SALES' ? -Math.abs(quantity) : Math.abs(quantity);
}
const ROW_CHUNK_SIZE = 500;
class DuplicateFileError extends Error {
    existingBatchId;
    constructor(existingBatchId) {
        super(`This file was already imported as batch ${existingBatchId}.`);
        this.existingBatchId = existingBatchId;
        this.name = 'DuplicateFileError';
    }
}
exports.DuplicateFileError = DuplicateFileError;
class BatchNotFoundError extends Error {
    constructor(batchId) {
        super(`Import batch ${batchId} was not found.`);
        this.name = 'BatchNotFoundError';
    }
}
exports.BatchNotFoundError = BatchNotFoundError;
class InvalidBatchStateError extends Error {
    constructor(batchId, expected, actual) {
        super(`Import batch ${batchId} must be in state [${expected.join(', ')}] for this action, but is ${actual}.`);
        this.name = 'InvalidBatchStateError';
    }
}
exports.InvalidBatchStateError = InvalidBatchStateError;
/**
 * Stages a new batch. Rejects a byte-identical re-upload (same checksum,
 * type, tenant) up front rather than creating a duplicate batch that would
 * later post duplicate movements - the guide's "file/content checksum...
 * idempotency" requirement, enforced before any row exists.
 */
async function createImportBatch(ctx, input) {
    const duplicate = await (0, import_checksum_js_1.findDuplicateBatch)(ctx.companyId, input.type, input.fileChecksum);
    if (duplicate)
        throw new DuplicateFileError(duplicate.id);
    const batchId = (0, node_crypto_1.randomUUID)();
    await db_js_1.prisma.$transaction(async (tx) => {
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
                commitPolicy: import_business_rules_js_1.IMPORT_TYPE_POLICY[input.type],
            },
        });
        for (let start = 0; start < input.rows.length; start += ROW_CHUNK_SIZE) {
            const chunk = input.rows.slice(start, start + ROW_CHUNK_SIZE);
            await tx.importRow.createMany({
                data: chunk.map((raw, offset) => ({
                    importBatchId: batchId,
                    rowNumber: start + offset + 1,
                    rawData: raw,
                    status: 'DRAFT',
                    companyId: ctx.companyId,
                })),
            });
        }
    });
    return db_js_1.prisma.importBatch.findFirstOrThrow({ where: { id: batchId, companyId: ctx.companyId } });
}
async function requireBatch(ctx, batchId) {
    const batch = await db_js_1.prisma.importBatch.findFirst({ where: { id: batchId, companyId: ctx.companyId } });
    if (!batch)
        throw new BatchNotFoundError(batchId);
    return batch;
}
function assertStatus(batch, expected) {
    if (!expected.includes(batch.status))
        throw new InvalidBatchStateError(batch.id, expected, batch.status);
}
/**
 * Validates every row (resolve-only, no writes to Item/Lot/StockLedger) in
 * chunks, so a 5,000+ row file's validation pass never holds one giant
 * result set in memory. Safe to re-run on a DRAFT or already-VALIDATED
 * batch - validation has no side effects to double up on.
 */
async function validateImportBatch(ctx, batchId) {
    const batch = await requireBatch(ctx, batchId);
    assertStatus(batch, ['DRAFT', 'VALIDATED']);
    let validCount = 0;
    let invalidCount = 0;
    let cursor;
    for (;;) {
        const rows = await db_js_1.prisma.importRow.findMany({
            where: { importBatchId: batchId, companyId: ctx.companyId },
            orderBy: { id: 'asc' },
            take: ROW_CHUNK_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!rows.length)
            break;
        for (const row of rows) {
            const result = await (0, import_row_validation_js_1.validateImportRow)(ctx, batch.type, row.rawData);
            if (result.ok === false) {
                invalidCount += 1;
                await db_js_1.prisma.importRow.update({
                    where: { id: row.id, companyId: ctx.companyId },
                    data: { status: 'INVALID', errors: result.errors },
                });
            }
            else {
                validCount += 1;
                await db_js_1.prisma.importRow.update({
                    where: { id: row.id, companyId: ctx.companyId },
                    data: { status: 'VALID', mappedData: result.mapped, errors: undefined, warnings: result.warnings },
                });
            }
        }
        cursor = rows[rows.length - 1].id;
    }
    await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId: ctx.companyId }, data: { validRows: validCount, invalidRows: invalidCount, status: 'VALIDATED' } });
    return { validRows: validCount, invalidRows: invalidCount };
}
/**
 * Moves a validated batch into the commit queue. For an ALL_OR_NOTHING
 * import type (opening stock), a batch with any invalid row is refused
 * outright here - FAILED, zero rows posted - rather than letting the
 * worker discover the problem after already posting some rows.
 */
async function queueImportBatchForCommit(ctx, batchId) {
    const batch = await requireBatch(ctx, batchId);
    assertStatus(batch, ['VALIDATED']);
    if (batch.commitPolicy === 'ALL_OR_NOTHING' && batch.invalidRows > 0) {
        await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId: ctx.companyId }, data: { status: 'FAILED' } });
        return;
    }
    await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId: ctx.companyId }, data: { status: 'QUEUED_FOR_COMMIT' } });
}
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
async function commitImportBatchChunk(companyId, batchId, chunkSize = ROW_CHUNK_SIZE) {
    const batch = await db_js_1.prisma.importBatch.findFirstOrThrow({ where: { id: batchId, companyId } });
    if (!['QUEUED_FOR_COMMIT', 'COMMITTING'].includes(batch.status))
        return { done: true, processed: 0 };
    if (batch.status === 'QUEUED_FOR_COMMIT') {
        await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId }, data: { status: 'COMMITTING' } });
    }
    const importer = await db_js_1.prisma.user.findFirstOrThrow({ where: { id: batch.importedById, companyId } });
    const ctx = { companyId: batch.companyId, tenantId: 'tenant-invexa', userId: importer.id, role: importer.role };
    const rows = await db_js_1.prisma.importRow.findMany({
        where: { importBatchId: batchId, companyId, status: 'VALID', rowNumber: { gt: batch.checkpointRowNumber } },
        orderBy: { rowNumber: 'asc' },
        take: chunkSize,
    });
    if (!rows.length) {
        const remainingInvalid = await db_js_1.prisma.importRow.count({ where: { importBatchId: batchId, companyId, status: 'INVALID' } });
        const finalStatus = remainingInvalid > 0 ? 'PARTIALLY_COMMITTED' : 'COMMITTED';
        await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId }, data: { status: finalStatus, invalidRows: remainingInvalid } });
        return { done: true, processed: 0 };
    }
    const movementType = MOVEMENT_TYPE_BY_IMPORT_TYPE[batch.type];
    for (const row of rows) {
        const mapped = row.mappedData;
        try {
            const lot = await (0, import_business_rules_js_1.resolveLotForItem)(mapped.itemId, mapped.lotNo);
            const late = await (0, import_business_rules_js_1.isLateMovement)(mapped.locationId, batch.type, new Date(mapped.transactionAt));
            const result = await (0, inventory_posting_service_js_1.postInventoryMovement)({
                tenant: ctx,
                itemId: mapped.itemId,
                lotId: lot.id,
                locationId: mapped.locationId,
                movementType,
                qtyDelta: signedQuantity(batch.type, mapped.quantity),
                idempotencyKey: `import:${batchId}:${row.rowNumber}`,
                sourceDocument: batch.fileName,
                sourceLineId: row.id,
                reason: `${batch.type} import row ${row.rowNumber}`,
            });
            await db_js_1.prisma.importRow.update({
                where: { id: row.id, companyId },
                data: {
                    status: 'COMMITTED',
                    movementId: result.movement.id,
                    processedAt: new Date(),
                    warnings: late ? [{ field: 'transactionAt', code: 'LATE_MOVEMENT', message: 'This transaction is dated before the location\'s last sync checkpoint.' }] : undefined,
                },
            });
            if (!late)
                await (0, import_business_rules_js_1.advanceSyncCheckpoint)(mapped.locationId, batch.type, new Date(mapped.transactionAt), batchId);
        }
        catch (error) {
            // A row that validated structurally can still fail at commit time -
            // most commonly a negative-stock block discovered only once real
            // concurrent stock levels are checked. This is the "partial failure"
            // the guide names: the row becomes INVALID (visible in the failure
            // export) and every other row in the chunk keeps going.
            const message = error instanceof inventory_posting_service_js_1.NegativeStockBlockedError ? error.message : error instanceof Error ? error.message : String(error);
            const code = error instanceof inventory_posting_service_js_1.NegativeStockBlockedError ? 'INSUFFICIENT_STOCK' : 'COMMIT_FAILED';
            await db_js_1.prisma.importRow.update({
                where: { id: row.id, companyId },
                data: { status: 'INVALID', errors: [{ field: 'quantity', code, message }] },
            });
        }
        await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId }, data: { checkpointRowNumber: row.rowNumber } });
    }
    return { done: false, processed: rows.length };
}
/** Runs commitImportBatchChunk to completion - the synchronous convenience wrapper tests and a worker's single tick both use. */
async function commitImportBatchToCompletion(ctx, batchId, chunkSize = ROW_CHUNK_SIZE) {
    for (;;) {
        const result = await commitImportBatchChunk(ctx.companyId, batchId, chunkSize);
        if (result.done)
            return;
    }
}
/**
 * Reverses every committed row's movement through
 * reverseInventoryMovement (Week 6) - an equal-and-opposite post, never an
 * edit to the original. Tolerates a row that was already reversed (a
 * retried/resumed reverse call), so calling this twice is itself safe.
 */
async function reverseImportBatch(ctx, batchId, reason) {
    const batch = await requireBatch(ctx, batchId);
    assertStatus(batch, ['COMMITTED', 'PARTIALLY_COMMITTED', 'REVERSING']);
    if (batch.status !== 'REVERSING') {
        await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId: ctx.companyId }, data: { status: 'REVERSING' } });
    }
    const rows = await db_js_1.prisma.importRow.findMany({
        where: { importBatchId: batchId, companyId: ctx.companyId, status: 'COMMITTED', movementId: { not: null } },
        orderBy: { rowNumber: 'asc' },
    });
    for (const row of rows) {
        try {
            await (0, inventory_posting_service_js_1.reverseInventoryMovement)(ctx, row.movementId, reason);
            await db_js_1.prisma.importRow.update({ where: { id: row.id, companyId: ctx.companyId }, data: { status: 'REVERSED' } });
        }
        catch (error) {
            if (error instanceof inventory_posting_service_js_1.AlreadyReversedError) {
                await db_js_1.prisma.importRow.update({ where: { id: row.id, companyId: ctx.companyId }, data: { status: 'REVERSED' } });
                continue;
            }
            throw error;
        }
    }
    await db_js_1.prisma.importBatch.update({ where: { id: batchId, companyId: ctx.companyId }, data: { status: 'REVERSED', reversedAt: new Date() } });
}
/** Every INVALID row's errors, flattened one error per line - the guide's downloadable "row, field, code and safe message" failure export. */
async function exportFailedRows(ctx, batchId) {
    await requireBatch(ctx, batchId);
    const rows = await db_js_1.prisma.importRow.findMany({ where: { importBatchId: batchId, companyId: ctx.companyId, status: 'INVALID' }, orderBy: { rowNumber: 'asc' } });
    const out = [];
    for (const row of rows) {
        const errors = row.errors ?? [];
        for (const error of errors)
            out.push({ rowNumber: row.rowNumber, field: error.field, code: error.code, message: error.message });
    }
    return out;
}
