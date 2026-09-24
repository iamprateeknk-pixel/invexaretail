"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetImportBatchStore = resetImportBatchStore;
exports.createPreviewBatch = createPreviewBatch;
exports.getBatch = getBatch;
exports.listRows = listRows;
exports.countRowsByStatus = countRowsByStatus;
exports.transitionBatch = transitionBatch;
exports.findDuplicateBatch = findDuplicateBatch;
exports.listStoredBatches = listStoredBatches;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const db_js_1 = require("./db.js");
const import_center_js_1 = require("./import-center.js");
const databaseEnabled = () => Boolean((0, db_js_1.resolveDatabaseUrl)());
// Only a POSTED batch has actually changed real stock, so only that status
// must block a re-import of the identical file (prevents double-applying the
// same movements). A PREVIEWED or VALIDATED batch is just staged preview
// state with zero real-world effect - blocking re-preview there would mean a
// stale, possibly-buggy staged preview (e.g. from before a bugfix deploy)
// could never be refreshed by re-uploading the same file, permanently
// wedging that upload.
const BLOCKING_STATUSES = ['POSTED'];
const memoryBatches = new Map();
const memoryRows = new Map();
function resetImportBatchStore() {
    memoryBatches.clear();
    memoryRows.clear();
}
function jsonRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : null;
}
function jsonStringArray(value) {
    if (!Array.isArray(value))
        return null;
    const items = value.filter((entry) => typeof entry === 'string');
    return items.length ? items : null;
}
function toIso(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function cloneRow(row) {
    return {
        rowNumber: row.rowNumber,
        status: row.status,
        rawData: { ...row.rawData },
        mappedData: row.mappedData ? { ...row.mappedData } : null,
        errors: row.errors ? [...row.errors] : null,
        warnings: row.warnings ? [...row.warnings] : null,
        sourceKey: row.sourceKey ?? null,
    };
}
function fromPrismaBatch(row) {
    return {
        id: row.id,
        type: row.type,
        fileName: row.fileName,
        sourceFormat: row.sourceFormat,
        importedById: row.importedById,
        importedAt: row.importedAt.toISOString(),
        totalRows: row.totalRows,
        validRows: row.validRows,
        invalidRows: row.invalidRows,
        duplicateRows: row.duplicateRows,
        metadata: jsonRecord(row.metadata),
        status: row.status,
        branchId: row.branchId,
        fileHash: row.fileHash,
        sourceDateFrom: toIso(row.sourceDateFrom),
        sourceDateTo: toIso(row.sourceDateTo),
    };
}
function rowId(batchId, rowNumber) {
    return `irow-${batchId}-${rowNumber}`.slice(0, 191);
}
async function createPreviewBatch(input) {
    const id = input.id ?? `imp-${input.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`;
    const record = {
        id,
        type: input.type,
        fileName: input.fileName,
        sourceFormat: input.sourceFormat,
        importedById: input.importedById,
        importedAt: new Date().toISOString(),
        totalRows: input.totalRows,
        validRows: input.validRows,
        invalidRows: input.invalidRows,
        duplicateRows: input.duplicateRows,
        metadata: input.metadata ?? null,
        status: 'PREVIEWED',
        branchId: input.branchId ?? null,
        fileHash: input.fileHash,
        sourceDateFrom: input.sourceDateFrom ?? null,
        sourceDateTo: input.sourceDateTo ?? null,
    };
    const rows = input.rows.map(cloneRow);
    if (!databaseEnabled()) {
        memoryBatches.set(id, record);
        memoryRows.set(id, rows);
        return { ...record, metadata: record.metadata ? { ...record.metadata } : null };
    }
    await db_js_1.prisma.$transaction(async (tx) => {
        await tx.importBatch.create({
            data: {
                id,
                type: record.type,
                fileName: record.fileName,
                sourceFormat: record.sourceFormat,
                importedById: record.importedById,
                totalRows: record.totalRows,
                validRows: record.validRows,
                invalidRows: record.invalidRows,
                duplicateRows: record.duplicateRows,
                metadata: (record.metadata ?? client_1.Prisma.JsonNull),
                status: record.status,
                branchId: record.branchId,
                fileHash: record.fileHash,
                sourceDateFrom: record.sourceDateFrom ? new Date(record.sourceDateFrom) : null,
                sourceDateTo: record.sourceDateTo ? new Date(record.sourceDateTo) : null,
            },
        });
        for (let offset = 0; offset < rows.length; offset += 400) {
            const chunk = rows.slice(offset, offset + 400);
            await tx.importRow.createMany({
                data: chunk.map((row) => ({
                    id: rowId(id, row.rowNumber),
                    importBatchId: id,
                    rowNumber: row.rowNumber,
                    rawData: row.rawData,
                    status: row.status,
                    errors: (row.errors ?? client_1.Prisma.JsonNull),
                    warnings: (row.warnings ?? client_1.Prisma.JsonNull),
                    mappedData: (row.mappedData ?? client_1.Prisma.JsonNull),
                    sourceKey: row.sourceKey ? row.sourceKey.slice(0, 191) : null,
                })),
            });
        }
    }, { maxWait: 10_000, timeout: 120_000 });
    return record;
}
async function getBatch(id) {
    if (!databaseEnabled()) {
        const found = memoryBatches.get(id);
        return found ? { ...found, metadata: found.metadata ? { ...found.metadata } : null } : undefined;
    }
    const row = await db_js_1.prisma.importBatch.findUnique({ where: { id } });
    return row ? fromPrismaBatch(row) : undefined;
}
async function listRows(id, status) {
    if (!databaseEnabled()) {
        const rows = memoryRows.get(id) ?? [];
        return rows.filter((row) => !status || row.status === status).map(cloneRow);
    }
    const rows = await db_js_1.prisma.importRow.findMany({
        where: { importBatchId: id, ...(status ? { status } : {}) },
        orderBy: { rowNumber: 'asc' },
    });
    return rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        rawData: jsonRecord(row.rawData) ?? {},
        mappedData: jsonRecord(row.mappedData),
        errors: jsonStringArray(row.errors),
        warnings: jsonStringArray(row.warnings),
        sourceKey: row.sourceKey,
    }));
}
async function countRowsByStatus(id) {
    const counts = { VALID: 0, INVALID: 0, DUPLICATE: 0 };
    if (!databaseEnabled()) {
        for (const row of memoryRows.get(id) ?? [])
            counts[row.status] += 1;
        return counts;
    }
    const grouped = await db_js_1.prisma.importRow.groupBy({
        by: ['status'],
        where: { importBatchId: id },
        _count: { _all: true },
    });
    for (const entry of grouped) {
        if (entry.status === 'VALID' || entry.status === 'INVALID' || entry.status === 'DUPLICATE') {
            counts[entry.status] = entry._count._all;
        }
    }
    return counts;
}
/**
 * Transitions a batch's status, guarded by a compare-and-swap on the status
 * read at the start of this call: if another request has already changed
 * the batch's status in the meantime (e.g. a double-click or client retry
 * on the same "Confirm" action racing this one), this throws
 * ConcurrentBatchTransitionError instead of silently overwriting the other
 * request's result or bubbling a raw "Cannot move batch from POSTED to
 * POSTED" state-machine error. Callers that do real work (posting stock,
 * etc.) between reading the batch and calling this must treat that error as
 * "already handled by the other request", not a crash.
 */
async function transitionBatch(id, to, metadataPatch) {
    const current = await getBatch(id);
    if (!current)
        throw new Error('Import batch was not found.');
    (0, import_center_js_1.assertValidBatchTransition)(current.status, to);
    const nextMetadata = metadataPatch ? { ...(current.metadata ?? {}), ...metadataPatch } : current.metadata;
    if (!databaseEnabled()) {
        const stillCurrent = memoryBatches.get(id);
        if (!stillCurrent || stillCurrent.status !== current.status)
            throw new import_center_js_1.ConcurrentBatchTransitionError(id);
        const updated = { ...stillCurrent, status: to, metadata: nextMetadata };
        memoryBatches.set(id, updated);
        return { ...updated, metadata: updated.metadata ? { ...updated.metadata } : null };
    }
    const result = await db_js_1.prisma.importBatch.updateMany({
        where: { id, status: current.status },
        data: {
            status: to,
            metadata: (nextMetadata ?? client_1.Prisma.JsonNull),
        },
    });
    if (result.count === 0)
        throw new import_center_js_1.ConcurrentBatchTransitionError(id);
    const updated = await getBatch(id);
    return updated;
}
async function findDuplicateBatch(input) {
    const branchId = input.branchId ?? null;
    const from = input.sourceDateFrom ?? null;
    const to = input.sourceDateTo ?? null;
    const matches = (batch) => batch.type === input.type
        && batch.fileHash === input.fileHash
        && batch.branchId === branchId
        && (batch.sourceDateFrom ?? null) === from
        && (batch.sourceDateTo ?? null) === to
        && BLOCKING_STATUSES.includes(batch.status);
    if (!databaseEnabled()) {
        return [...memoryBatches.values()].find(matches);
    }
    const row = await db_js_1.prisma.importBatch.findFirst({
        where: {
            type: input.type,
            fileHash: input.fileHash,
            status: { in: BLOCKING_STATUSES },
            branchId,
            sourceDateFrom: from ? new Date(from) : null,
            sourceDateTo: to ? new Date(to) : null,
        },
        orderBy: { importedAt: 'desc' },
    });
    return row ? fromPrismaBatch(row) : undefined;
}
function listStoredBatches(limit = 100) {
    return [...memoryBatches.values()]
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
        .slice(0, Math.min(Math.max(limit, 1), 250))
        .map((batch) => ({
        id: batch.id,
        type: batch.type,
        fileName: batch.fileName,
        importedAt: batch.importedAt,
        totalRows: batch.totalRows,
        validRows: batch.validRows,
        invalidRows: batch.invalidRows,
        duplicateRows: batch.duplicateRows,
        status: batch.status,
        branchId: batch.branchId,
        metadata: batch.metadata,
    }));
}
