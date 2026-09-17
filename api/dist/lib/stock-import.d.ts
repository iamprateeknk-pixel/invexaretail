export type StockImportFormat = 'invexa-expiry-stock' | 'standard-items';
export type StockImportRow = {
    rowNumber: number;
    code: string;
    itemName: string;
    companyName?: string;
    category?: string;
    subcategory?: string;
    unit?: string;
    locationName?: string;
    lotNo?: string;
    batch?: string;
    expiryDate?: string | null;
    quantity?: number;
    purchaseValue?: number;
    saleValue?: number;
};
export type StockImportError = {
    rowNumber: number;
    message: string;
};
export type StockImportPreview = {
    format: StockImportFormat;
    sheetName: string;
    headerRow: number;
    snapshotAt: string;
    totalRows: number;
    validRows: StockImportRow[];
    errors: StockImportError[];
    duplicateRows: number;
    negativeQuantityRows: number;
    fractionalQuantityRows: number;
    branches: string[];
    mapping: Record<string, string>;
};
export declare function readTabularFile(buffer: Buffer, fileName: string): Promise<{
    sheetName: string;
    rows: unknown[][];
}>;
export declare function parseStockImport(buffer: Buffer, fileName: string): Promise<StockImportPreview>;
export declare function aggregateOpeningStock(rows: StockImportRow[]): StockImportRow[];
export declare function importPreviewResponse(preview: StockImportPreview): {
    format: StockImportFormat;
    sheetName: string;
    headerRow: number;
    snapshotAt: string;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    negativeQuantityRows: number;
    fractionalQuantityRows: number;
    branches: string[];
    mapping: Record<string, string>;
    sample: StockImportRow[];
    errors: StockImportError[];
};
