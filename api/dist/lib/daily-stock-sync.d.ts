export type DailyImportType = 'SALES' | 'PURCHASE';
export type DailyStockRow = {
    rowNumber: number;
    locationName: string;
    reference: string;
    lineNo: string;
    itemCode?: string;
    itemName: string;
    unit?: string;
    quantity: number;
    lotNo?: string;
    transactionAt: string;
    movementType: 'SALE_OUT' | 'SALES_RETURN' | 'PURCHASE_IN';
    dedupeKey: string;
    rate?: number;
    amount?: number;
    timeAssumed: boolean;
    rowSource?: string;
};
export type DailyImportDuplicate = {
    rowNumber: number;
    message: string;
    dedupeKey: string;
};
export type DailyImportPreview = {
    importType: DailyImportType;
    sheetName: string;
    headerRow: number;
    totalRows: number;
    validRows: DailyStockRow[];
    errors: Array<{
        rowNumber: number;
        message: string;
    }>;
    duplicates: DailyImportDuplicate[];
    duplicateRows: number;
    mapping: Record<string, string>;
    transactionFrom?: string;
    transactionTo?: string;
};
export declare function matchImportLocation<T extends {
    name: string;
}>(sourceName: string, locations: readonly T[]): T | undefined;
export declare function parseDailyStockImport(buffer: Buffer, fileName: string, kind: DailyImportType, options: {
    purchaseLocationName: string;
    purchaseTime?: string;
}): Promise<DailyImportPreview>;
