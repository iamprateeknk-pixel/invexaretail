export declare function buildSalesCsv(rowCount: number, options?: {
    branchName?: string;
    itemCode?: string;
    itemName?: string;
    quantity?: number;
    includeLineNo?: boolean;
    rowSource?: string;
}): string;
export declare function salesCsvBuffer(rowCount: number, options?: Parameters<typeof buildSalesCsv>[1]): Buffer;
