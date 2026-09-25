import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, resolveDatabaseUrl } from './db.js';
import {
  assertValidBatchTransition,
  type ImportBatchStatus,
} from './import-center.js';

const databaseEnabled = () => Boolean(resolveDatabaseUrl());

// Only a POSTED batch has actually changed real stock, so only that status
// must block a re-import of the identical file (prevents double-applying the
// same movements). A PREVIEWED or VALIDATED batch is just staged preview
// state with zero real-world effect - blocking re-preview there would mean a
// stale, possibly-buggy staged preview (e.g. from before a bugfix deploy)
// could never be refreshed by re-uploading the same file, permanently
// wedging that upload.
const BLOCKING_STATUSES: ImportBatchStatus[] = ['POSTED'];

export type StagedRowStatus = 'VALID' | 'INVALID' | 'DUPLICATE';

export type StagedImportRow = {
  rowNumber: number;
  status: StagedRowStatus;
  rawData: Record<string, unknown>;
  mappedData?: Record<string, unknown> | null;
  errors?: string[] | null;
  warnings?: string[] | null;
  sourceKey?: string | null;
};

export type ImportBatchRecord = {
  id: string;
  companyId: string;
  type: string;
  fileName: string;
  sourceFormat: string;
  importedById: string;
  importedAt: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  metadata: Record<string, unknown> | null;
  status: ImportBatchStatus;
  branchId: string | null;
  fileHash: string | null;
  sourceDateFrom: string | null;
  sourceDateTo: string | null;
};

export type CreatePreviewBatchInput = {
  companyId: string;
  id?: string;
  type: string;
  fileName: string;
  sourceFormat: string;
  importedById: string;
  fileHash: string;
  branchId?: string | null;
  sourceDateFrom?: string | null;
  sourceDateTo?: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  metadata?: Record<string, unknown> | null;
  rows: StagedImportRow[];
};

const memoryBatches = new Map<string, ImportBatchRecord>();
const memoryRows = new Map<string, StagedImportRow[]>();

export function resetImportBatchStore(): void {
  memoryBatches.clear();
  memoryRows.clear();
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : null;
}

function jsonStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((entry): entry is string => typeof entry === 'string');
  return items.length ? items : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cloneRow(row: StagedImportRow): StagedImportRow {
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

function fromPrismaBatch(row: {
  id: string;
  companyId: string;
  type: string;
  fileName: string;
  sourceFormat: string;
  importedById: string;
  importedAt: Date;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  metadata: Prisma.JsonValue | null;
  status: string;
  branchId: string | null;
  fileHash: string | null;
  sourceDateFrom: Date | null;
  sourceDateTo: Date | null;
}): ImportBatchRecord {
  return {
    id: row.id,
    companyId: row.companyId,
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
    status: row.status as ImportBatchStatus,
    branchId: row.branchId,
    fileHash: row.fileHash,
    sourceDateFrom: toIso(row.sourceDateFrom),
    sourceDateTo: toIso(row.sourceDateTo),
  };
}

function rowId(batchId: string, rowNumber: number): string {
  return `irow-${batchId}-${rowNumber}`.slice(0, 191);
}

export async function createPreviewBatch(input: CreatePreviewBatchInput): Promise<ImportBatchRecord> {
  const id = input.id ?? `imp-${input.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const record: ImportBatchRecord = {
    id,
    companyId: input.companyId,
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

  await prisma.$transaction(async (tx) => {
    await tx.importBatch.create({
      data: {
        id,
        companyId: input.companyId,
        type: record.type,
        fileName: record.fileName,
        sourceFormat: record.sourceFormat,
        importedById: record.importedById,
        totalRows: record.totalRows,
        validRows: record.validRows,
        invalidRows: record.invalidRows,
        duplicateRows: record.duplicateRows,
        metadata: (record.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
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
          companyId: input.companyId,
          rowNumber: row.rowNumber,
          rawData: row.rawData as Prisma.InputJsonValue,
          status: row.status,
          errors: (row.errors ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          warnings: (row.warnings ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          mappedData: (row.mappedData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          sourceKey: row.sourceKey ? row.sourceKey.slice(0, 191) : null,
        })),
      });
    }
  }, { maxWait: 10_000, timeout: 120_000 });

  return record;
}

export async function getBatch(companyId: string, id: string): Promise<ImportBatchRecord | undefined> {
  if (!databaseEnabled()) {
    const found = memoryBatches.get(id);
    return found?.companyId === companyId ? { ...found, metadata: found.metadata ? { ...found.metadata } : null } : undefined;
  }
  const row = await prisma.importBatch.findFirst({ where: { id, companyId } });
  return row ? fromPrismaBatch(row) : undefined;
}

export async function listRows(companyId: string, id: string, status?: StagedRowStatus): Promise<StagedImportRow[]> {
  if (!databaseEnabled()) {
    if (memoryBatches.get(id)?.companyId !== companyId) return [];
    const rows = memoryRows.get(id) ?? [];
    return rows.filter((row) => !status || row.status === status).map(cloneRow);
  }
  const rows = await prisma.importRow.findMany({
    where: { importBatchId: id, companyId, ...(status ? { status } : {}) },
    orderBy: { rowNumber: 'asc' },
  });
  return rows.map((row) => ({
    rowNumber: row.rowNumber,
    status: row.status as StagedRowStatus,
    rawData: jsonRecord(row.rawData) ?? {},
    mappedData: jsonRecord(row.mappedData),
    errors: jsonStringArray(row.errors),
    warnings: jsonStringArray(row.warnings),
    sourceKey: row.sourceKey,
  }));
}

export async function countRowsByStatus(companyId: string, id: string): Promise<Record<StagedRowStatus, number>> {
  const counts: Record<StagedRowStatus, number> = { VALID: 0, INVALID: 0, DUPLICATE: 0 };
  if (!databaseEnabled()) {
    if (memoryBatches.get(id)?.companyId !== companyId) return counts;
    for (const row of memoryRows.get(id) ?? []) counts[row.status] += 1;
    return counts;
  }
  const grouped = await prisma.importRow.groupBy({
    by: ['status'],
    where: { importBatchId: id, companyId },
    _count: { _all: true },
  });
  for (const entry of grouped) {
    if (entry.status === 'VALID' || entry.status === 'INVALID' || entry.status === 'DUPLICATE') {
      counts[entry.status] = entry._count._all;
    }
  }
  return counts;
}

export async function transitionBatch(companyId: string, id: string, to: ImportBatchStatus, metadataPatch?: Record<string, unknown>): Promise<ImportBatchRecord> {
  const current = await getBatch(companyId, id);
  if (!current) throw new Error('Import batch was not found.');
  assertValidBatchTransition(current.status, to);
  const nextMetadata = metadataPatch ? { ...(current.metadata ?? {}), ...metadataPatch } : current.metadata;
  if (!databaseEnabled()) {
    const updated: ImportBatchRecord = { ...current, status: to, metadata: nextMetadata };
    memoryBatches.set(id, updated);
    return { ...updated, metadata: updated.metadata ? { ...updated.metadata } : null };
  }
  const updated = await prisma.importBatch.update({
    where: { id, companyId },
    data: {
      status: to,
      metadata: (nextMetadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    },
  });
  return fromPrismaBatch(updated);
}

export async function findDuplicateBatch(input: {
  companyId: string;
  type: string;
  fileHash: string;
  branchId?: string | null;
  sourceDateFrom?: string | null;
  sourceDateTo?: string | null;
}): Promise<ImportBatchRecord | undefined> {
  const branchId = input.branchId ?? null;
  const from = input.sourceDateFrom ?? null;
  const to = input.sourceDateTo ?? null;
  const matches = (batch: ImportBatchRecord) =>
    batch.companyId === input.companyId
    && batch.type === input.type
    && batch.fileHash === input.fileHash
    && batch.branchId === branchId
    && (batch.sourceDateFrom ?? null) === from
    && (batch.sourceDateTo ?? null) === to
    && BLOCKING_STATUSES.includes(batch.status);

  if (!databaseEnabled()) {
    return [...memoryBatches.values()].find(matches);
  }
  const row = await prisma.importBatch.findFirst({
    where: {
      companyId: input.companyId,
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

export function listStoredBatches(companyId: string, limit = 100): Array<Pick<ImportBatchRecord, 'id' | 'type' | 'fileName' | 'importedAt' | 'totalRows' | 'validRows' | 'invalidRows' | 'duplicateRows' | 'status' | 'branchId' | 'metadata'>> {
  return [...memoryBatches.values()]
    .filter((batch) => batch.companyId === companyId)
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
