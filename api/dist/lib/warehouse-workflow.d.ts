export type TransferImportRow = {
    rowNumber: number;
    destinationStore?: string;
    itemCode?: string;
    itemName?: string;
    requestedQty: number;
    unit?: string;
    remarks?: string;
};
export type TransferImportPreview = {
    sheetName: string;
    headerRow: number;
    totalRows: number;
    validRows: TransferImportRow[];
    errors: Array<{
        rowNumber: number;
        message: string;
    }>;
    duplicateRows: number;
    mapping: Record<string, string>;
};
export declare function parseTransferImport(buffer: Buffer, fileName: string): Promise<TransferImportPreview>;
export type LotStatus = 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE';
export type FefoLot = {
    lotId: string;
    lotNo: string;
    expiryDate?: string | null;
    available: number;
    createdAt?: string;
    status?: LotStatus;
};
export declare function allocateFefo(lots: FefoLot[], requestedQty: number): {
    allocations: Array<FefoLot & {
        quantity: number;
    }>;
    shortage: number;
};
export type AllocationStrategy = 'FEFO' | 'FIFO' | 'MANUAL';
export type ManualAllocationLine = {
    lotId: string;
    quantity: number;
};
export type LotAllocationResult = {
    allocations: Array<FefoLot & {
        quantity: number;
    }>;
    shortage: number;
    strategy: AllocationStrategy;
};
export declare class ManualAllocationRequiresReasonError extends Error {
    constructor();
}
export declare class LotNotAllocatableError extends Error {
    readonly lotId: string;
    readonly status: LotStatus;
    constructor(lotId: string, status: LotStatus);
}
export declare class ManualAllocationExceedsAvailableError extends Error {
    readonly lotId: string;
    readonly requested: number;
    readonly available: number;
    constructor(lotId: string, requested: number, available: number);
}
/**
 * Configurable allocation by category/SKU (blueprint 17): FEFO (default for
 * expiry-controlled inventory), FIFO (oldest lot first by createdAt), or an
 * authorized MANUAL override. A manual override still validates each line
 * against actual availability and against the lot's status — an authorized
 * override can choose which available lots to draw from, but it cannot pull
 * stock that doesn't exist or pull from a blocked/expired/quarantined lot.
 */
export declare function allocateLots(lots: FefoLot[], requestedQty: number, strategy: AllocationStrategy, options?: {
    manualLines?: ManualAllocationLine[];
    overrideReason?: string;
}): LotAllocationResult;
export declare const PICK_EXCEPTION_REASONS: readonly ["NO_STOCK", "WRONG_ITEM", "DAMAGED_ITEM"];
export declare function validatePickInput(input: {
    unit?: string;
    quantity: number;
    inputMethod: string;
    scanCode?: string;
    itemCode: string;
    lotNo: string;
}): void;
