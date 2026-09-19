"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageDailyImport = stageDailyImport;
exports.stageOpeningStock = stageOpeningStock;
exports.stageStockAdjustment = stageStockAdjustment;
exports.movementsFromStagedDailyRows = movementsFromStagedDailyRows;
exports.openingPreviewFromStagedRows = openingPreviewFromStagedRows;
exports.buildBatchPreviewPayload = buildBatchPreviewPayload;
exports.buildErrorCsv = buildErrorCsv;
exports.duplicateConflictMessage = duplicateConflictMessage;
const import_center_js_1 = require("./import-center.js");
const import_control_center_js_1 = require("./import-control-center.js");
const import_batch_store_js_1 = require("./import-batch-store.js");
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}
function stageDailyImport(preview, plan) {
    const staged = new Map();
    const planErrors = new Map();
    for (const error of plan.errors) {
        if (!error.rowNumber)
            continue;
        const list = planErrors.get(error.rowNumber) ?? [];
        list.push(error.message);
        planErrors.set(error.rowNumber, list);
    }
    const allocations = new Map();
    for (const entry of plan.prepared) {
        const list = allocations.get(entry.row.rowNumber) ?? [];
        list.push(entry);
        allocations.set(entry.row.rowNumber, list);
    }
    for (const error of preview.errors) {
        staged.set(error.rowNumber || staged.size + 1, {
            rowNumber: error.rowNumber || staged.size + 1,
            status: 'INVALID',
            rawData: { message: error.message },
            errors: [error.message],
        });
    }
    for (const duplicate of preview.duplicates ?? []) {
        staged.set(duplicate.rowNumber, {
            rowNumber: duplicate.rowNumber,
            status: 'DUPLICATE',
            rawData: { message: duplicate.message, dedupeKey: duplicate.dedupeKey },
            errors: [duplicate.message],
            sourceKey: duplicate.dedupeKey,
        });
    }
    for (const row of preview.validRows) {
        const mappedAllocations = (allocations.get(row.rowNumber) ?? []).map((entry) => ({
            itemId: entry.item.id,
            itemCode: entry.item.code,
            lotId: entry.lotId,
            locationId: entry.locationId,
            qtyDelta: entry.qtyDelta,
            newLot: entry.newLot ?? null,
        }));
        const failures = planErrors.get(row.rowNumber) ?? [];
        const rawData = {
            rowNumber: row.rowNumber,
            locationName: row.locationName,
            reference: row.reference,
            lineNo: row.lineNo,
            itemCode: row.itemCode,
            itemName: row.itemName,
            unit: row.unit,
            quantity: row.quantity,
            lotNo: row.lotNo,
            transactionAt: row.transactionAt,
            movementType: row.movementType,
            dedupeKey: row.dedupeKey,
            rate: row.rate,
            amount: row.amount,
            timeAssumed: row.timeAssumed,
            rowSource: row.rowSource,
        };
        staged.set(row.rowNumber, {
            rowNumber: row.rowNumber,
            status: mappedAllocations.length && !failures.length ? 'VALID' : 'INVALID',
            rawData,
            mappedData: mappedAllocations.length ? {
                ...rawData,
                allocations: mappedAllocations,
            } : rawData,
            errors: failures.length ? failures : (mappedAllocations.length ? null : ['This row could not be mapped to stock.']),
            sourceKey: row.dedupeKey,
        });
    }
    return [...staged.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}
function stageOpeningStock(preview) {
    const staged = new Map();
    for (const error of preview.errors) {
        staged.set(error.rowNumber || staged.size + 1, {
            rowNumber: error.rowNumber || staged.size + 1,
            status: 'INVALID',
            rawData: { message: error.message },
            errors: [error.message],
        });
    }
    for (const row of preview.validRows) {
        staged.set(row.rowNumber, {
            rowNumber: row.rowNumber,
            status: 'VALID',
            rawData: { ...row },
            mappedData: { ...row },
            sourceKey: `${row.code}|${row.lotNo ?? ''}|${row.locationName ?? ''}|${row.rowNumber}`,
        });
    }
    return [...staged.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}
// Same branch+item+lot key aggregateOpeningStock() groups by. A row sharing
// this key with an earlier row in the file is not invalid - its quantity was
// folded into that earlier row's prepared entry (multiple report lines for
// one physical lot, e.g. split batches, are common in ERP closing-stock
// exports) - so it must resolve to that same entry here too, not be reported
// as unmapped.
function adjustmentRowKey(row) {
    return `${row.locationName?.trim().toLowerCase() ?? ''}|${row.code.trim().toLowerCase()}|${(row.lotNo ?? '').trim().toLowerCase()}`;
}
function stageStockAdjustment(preview, plan, mode) {
    const staged = stageOpeningStock(preview);
    const planErrors = new Map();
    for (const error of plan.errors) {
        if (!error.rowNumber)
            continue;
        const list = planErrors.get(error.rowNumber) ?? [];
        list.push(error.message);
        planErrors.set(error.rowNumber, list);
    }
    const byRow = new Map(plan.prepared.map((entry) => [entry.row.rowNumber, entry]));
    const byKey = new Map(plan.prepared.map((entry) => [adjustmentRowKey(entry.row), entry]));
    const sourceRowByNumber = new Map(preview.validRows.map((row) => [row.rowNumber, row]));
    return staged.map((row) => {
        const sourceRow = sourceRowByNumber.get(row.rowNumber);
        const prepared = byRow.get(row.rowNumber) ?? (sourceRow ? byKey.get(adjustmentRowKey(sourceRow)) : undefined);
        const failures = planErrors.get(row.rowNumber) ?? row.errors ?? [];
        if (!prepared) {
            return { ...row, status: 'INVALID', errors: failures.length ? failures : ['This row could not be mapped to stock.'] };
        }
        const mergedIntoRow = prepared.row.rowNumber !== row.rowNumber ? prepared.row.rowNumber : null;
        return {
            ...row,
            status: 'VALID',
            errors: null,
            mappedData: {
                mode,
                itemId: prepared.item.id,
                itemCode: prepared.item.code,
                itemName: prepared.item.name,
                locationId: prepared.location.id,
                locationName: prepared.location.name,
                lotId: prepared.lotId,
                lotNo: prepared.lotNo,
                expiryDate: prepared.expiryDate ?? null,
                isNewLot: prepared.isNewLot,
                currentQty: prepared.currentQty,
                qtyDelta: prepared.qtyDelta,
                resultingQty: prepared.resultingQty,
                mergedIntoRow,
                row: prepared.row,
            },
            sourceKey: `${mode}|${prepared.item.id}|${prepared.lotId}|${prepared.location.id}|${row.rowNumber}`,
        };
    });
}
function movementsFromStagedDailyRows(batchId, createdById, importType, rows) {
    const movements = [];
    const lots = [];
    const seenLots = new Set();
    let index = 0;
    for (const row of rows) {
        if (row.status !== 'VALID' || !row.mappedData)
            continue;
        const mapped = row.mappedData;
        const allocations = Array.isArray(mapped.allocations) ? mapped.allocations : [];
        for (const allocation of allocations) {
            const entry = asRecord(allocation);
            const lotId = String(entry.lotId ?? '');
            const itemId = String(entry.itemId ?? '');
            const locationId = String(entry.locationId ?? '');
            if (!lotId || !itemId || !locationId)
                continue;
            const newLot = asRecord(entry.newLot);
            if (newLot.id && !seenLots.has(String(newLot.id))) {
                seenLots.add(String(newLot.id));
                lots.push({
                    id: String(newLot.id),
                    itemId: String(newLot.itemId ?? itemId),
                    lotNo: String(newLot.lotNo ?? 'LOT-DEFAULT'),
                    expiryDate: typeof newLot.expiryDate === 'string' ? newLot.expiryDate : null,
                    attributes: asRecord(newLot.attributes),
                });
            }
            const sourceReference = String(mapped.reference ?? mapped.sourceReference ?? batchId);
            const dedupeBase = String(mapped.dedupeKey ?? row.sourceKey ?? `${importType}|${row.rowNumber}`);
            movements.push({
                id: `move-${batchId}-${index}`,
                dedupeKey: `${dedupeBase}|${lotId}`,
                itemId,
                lotId,
                locationId,
                movementType: String(mapped.movementType ?? (importType === 'PURCHASE' ? 'PURCHASE_IN' : 'SALE_OUT')),
                qtyDelta: Number(entry.qtyDelta),
                transactionAt: String(mapped.transactionAt ?? new Date().toISOString()),
                sourceType: importType,
                sourceReference,
                importBatchId: batchId,
                createdById,
                metadata: {
                    lineNo: mapped.lineNo,
                    sourceItemName: mapped.itemName,
                    rate: mapped.rate,
                    amount: mapped.amount,
                    timeAssumed: mapped.timeAssumed,
                    rowSource: mapped.rowSource,
                    sourceRow: row.rowNumber,
                },
            });
            index += 1;
        }
    }
    return { movements, lots };
}
function openingPreviewFromStagedRows(batch, rows) {
    const meta = batch.metadata ?? {};
    const validRows = rows
        .filter((row) => row.status === 'VALID' && row.mappedData)
        // A row merged into an earlier row (see stageStockAdjustment's
        // mergedIntoRow) already had its quantity folded into that earlier row's
        // resultingQty - including it again here would double-count it once
        // this list goes through aggregateOpeningStock() a second time below.
        .filter((row) => !row.mappedData.mergedIntoRow)
        .map((row) => {
        const mapped = row.mappedData;
        // Two different staging shapes feed this function: stageOpeningStock's
        // mappedData already *is* a StockImportRow (OPENING_STOCK);
        // stageStockAdjustment's mappedData is an adjustment-plan shape
        // (itemCode/qtyDelta/resultingQty, no `code`/`quantity` fields -
        // ADJUSTMENT_SET). Normalize both to StockImportRow here rather than
        // blindly casting, which crashed on `row.code.toLowerCase()` downstream
        // for the adjustment shape.
        const normalized = {
            rowNumber: row.rowNumber,
            code: typeof mapped.code === 'string' ? mapped.code : String(mapped.itemCode ?? ''),
            itemName: typeof mapped.itemName === 'string' ? mapped.itemName : '',
            companyName: typeof mapped.companyName === 'string' ? mapped.companyName : undefined,
            category: typeof mapped.category === 'string' ? mapped.category : undefined,
            subcategory: typeof mapped.subcategory === 'string' ? mapped.subcategory : undefined,
            unit: typeof mapped.unit === 'string' ? mapped.unit : undefined,
            locationName: typeof mapped.locationName === 'string' ? mapped.locationName : undefined,
            lotNo: typeof mapped.lotNo === 'string' ? mapped.lotNo : undefined,
            batch: typeof mapped.batch === 'string' ? mapped.batch : undefined,
            expiryDate: mapped.expiryDate === null ? null : (typeof mapped.expiryDate === 'string' ? mapped.expiryDate : undefined),
            quantity: typeof mapped.quantity === 'number' ? mapped.quantity : (typeof mapped.resultingQty === 'number' ? mapped.resultingQty : undefined),
            purchaseValue: typeof mapped.purchaseValue === 'number' ? mapped.purchaseValue : undefined,
            saleValue: typeof mapped.saleValue === 'number' ? mapped.saleValue : undefined,
        };
        return normalized;
    });
    return {
        format: (typeof meta.format === 'string' ? meta.format : 'invexa-expiry-stock'),
        sheetName: typeof meta.sheetName === 'string' ? meta.sheetName : batch.fileName,
        headerRow: typeof meta.headerRow === 'number' ? meta.headerRow : 1,
        snapshotAt: typeof meta.snapshotAt === 'string' ? meta.snapshotAt : new Date().toISOString(),
        totalRows: batch.totalRows,
        validRows,
        errors: [],
        duplicateRows: batch.duplicateRows,
        negativeQuantityRows: Number(meta.negativeQuantityRows ?? 0),
        fractionalQuantityRows: Number(meta.fractionalQuantityRows ?? 0),
        branches: Array.isArray(meta.branches) ? meta.branches.filter((entry) => typeof entry === 'string') : [],
        mapping: asRecord(meta.mapping),
    };
}
async function buildBatchPreviewPayload(batchId) {
    const batch = await (0, import_batch_store_js_1.getBatch)(batchId);
    if (!batch)
        return undefined;
    const counts = await (0, import_batch_store_js_1.countRowsByStatus)(batchId);
    const rows = await (0, import_batch_store_js_1.listRows)(batchId);
    const errors = rows
        .filter((row) => row.status === 'INVALID')
        .flatMap((row) => (row.errors ?? ['Invalid row']).map((message) => ({ rowNumber: row.rowNumber, message })));
    const sample = rows
        .filter((row) => row.status === 'VALID' && row.mappedData)
        .slice(0, 20)
        .map((row) => {
        const mapped = row.mappedData ?? {};
        const allocations = Array.isArray(mapped.allocations) ? mapped.allocations : [];
        const first = allocations[0] ? asRecord(allocations[0]) : {};
        return {
            rowNumber: row.rowNumber,
            locationName: mapped.locationName ?? mapped.locationName,
            itemCode: first.itemCode ?? mapped.itemCode ?? mapped.code,
            itemName: mapped.itemName ?? mapped.name,
            movementType: mapped.movementType,
            qtyDelta: first.qtyDelta ?? mapped.qtyDelta ?? mapped.quantity,
            lotNo: mapped.lotNo,
            transactionAt: mapped.transactionAt,
            timeAssumed: mapped.timeAssumed,
            rowSource: mapped.rowSource,
        };
    });
    return {
        batchToken: batch.id,
        status: batch.status,
        sheetName: batch.metadata?.sheetName ?? batch.fileName,
        headerRow: batch.metadata?.headerRow ?? 1,
        format: batch.metadata?.format,
        transactionFrom: batch.sourceDateFrom,
        transactionTo: batch.sourceDateTo,
        totalRows: batch.totalRows,
        validRows: counts.VALID,
        invalidRows: counts.INVALID,
        duplicateRows: counts.DUPLICATE,
        // Blueprint v4 §10.1: unmatched item / branch / lot are counted apart from other rejections.
        counters: (0, import_control_center_js_1.summarizeRowCounters)(rows),
        errors: errors.slice(0, 100),
        sample,
        branches: batch.metadata?.branches,
        mapping: batch.metadata?.mapping,
        negativeQuantityRows: batch.metadata?.negativeQuantityRows,
        fractionalQuantityRows: batch.metadata?.fractionalQuantityRows,
        newItems: batch.metadata?.newItems,
        newLocations: batch.metadata?.newLocations,
    };
}
async function buildErrorCsv(batchId) {
    const batch = await (0, import_batch_store_js_1.getBatch)(batchId);
    if (!batch)
        return undefined;
    const rows = await (0, import_batch_store_js_1.listRows)(batchId, 'INVALID');
    return (0, import_center_js_1.errorReportToCsv)((0, import_center_js_1.buildImportErrorReport)(rows.flatMap((row) => (row.errors ?? ['Invalid row']).map((message) => ({ rowNumber: row.rowNumber, message })))));
}
function duplicateConflictMessage(batch) {
    if (batch.status === 'POSTED')
        return `This file was already committed as batch ${batch.id}. Reverse it before importing again.`;
    if (batch.status === 'VALIDATED')
        return `This file is already validated as batch ${batch.id}. Confirm that batch to post it once.`;
    return `This file is already previewed as batch ${batch.id}.`;
}
