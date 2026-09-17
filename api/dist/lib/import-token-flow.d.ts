import type { DailyImportPreview, DailyStockRow } from './daily-stock-sync.js';
import type { ImportBatchRecord, StagedImportRow } from './import-batch-store.js';
import type { DailyMovementRecord, LotRecord } from './repository.js';
import type { StockImportPreview, StockImportRow } from './stock-import.js';
type DailyPlanEntry = {
    row: DailyStockRow;
    item: {
        id: string;
        code: string;
        name: string;
    };
    locationId: string;
    lotId: string;
    qtyDelta: number;
    newLot?: LotRecord;
};
type DailyPlan = {
    errors: Array<{
        rowNumber: number;
        message: string;
    }>;
    prepared: DailyPlanEntry[];
};
export declare function stageDailyImport(preview: DailyImportPreview, plan: DailyPlan): StagedImportRow[];
export declare function stageOpeningStock(preview: StockImportPreview): StagedImportRow[];
export type AdjustmentPlanEntry = {
    row: StockImportRow;
    item: {
        id: string;
        code: string;
        name: string;
    };
    location: {
        id: string;
        name: string;
    };
    lotId: string;
    lotNo: string;
    expiryDate?: string | null;
    isNewLot: boolean;
    currentQty: number;
    qtyDelta: number;
    resultingQty: number;
};
export declare function stageStockAdjustment(preview: StockImportPreview, plan: {
    errors: Array<{
        rowNumber: number;
        message: string;
    }>;
    prepared: AdjustmentPlanEntry[];
}, mode: string): StagedImportRow[];
export declare function movementsFromStagedDailyRows(batchId: string, createdById: string, importType: 'SALES' | 'PURCHASE', rows: StagedImportRow[]): {
    movements: DailyMovementRecord[];
    lots: LotRecord[];
};
export declare function openingPreviewFromStagedRows(batch: ImportBatchRecord, rows: StagedImportRow[]): StockImportPreview;
export declare function buildBatchPreviewPayload(batchId: string): Promise<{
    batchToken: string;
    status: import("./import-center.js").ImportBatchStatus;
    sheetName: unknown;
    headerRow: unknown;
    format: unknown;
    transactionFrom: string;
    transactionTo: string;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    errors: {
        rowNumber: number;
        message: string;
    }[];
    sample: {
        rowNumber: number;
        locationName: unknown;
        itemCode: unknown;
        itemName: unknown;
        movementType: unknown;
        qtyDelta: unknown;
        lotNo: unknown;
        transactionAt: unknown;
        timeAssumed: unknown;
        rowSource: unknown;
    }[];
    branches: unknown;
    mapping: unknown;
    negativeQuantityRows: unknown;
    fractionalQuantityRows: unknown;
    newItems: unknown;
    newLocations: unknown;
}>;
export declare function buildErrorCsv(batchId: string): Promise<string | undefined>;
export declare function duplicateConflictMessage(batch: ImportBatchRecord): string;
export {};
