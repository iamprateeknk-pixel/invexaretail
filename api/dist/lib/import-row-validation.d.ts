import type { TenantContext } from './tenant-context.js';
import type { ImportType } from './import-business-rules.js';
export type RowError = {
    field: string;
    code: string;
    message: string;
};
export type MappedPurchaseSalesRow = {
    itemCode: string;
    itemId: string;
    lotNo: string;
    quantity: number;
    locationId: string;
    transactionAt: string;
    branchName?: string;
};
export type RowValidationResult = {
    ok: true;
    mapped: MappedPurchaseSalesRow;
    warnings: RowError[];
} | {
    ok: false;
    errors: RowError[];
};
export type RawImportRow = {
    itemCode?: unknown;
    lotNo?: unknown;
    quantity?: unknown;
    branchName?: unknown;
    transactionAt?: unknown;
};
/**
 * Resolves and validates one row for PURCHASE, SALES or SALES_RETURN.
 * Does not write anything - lot creation and the actual stock post happen
 * at commit time, atomically with each other, so a batch that is only
 * ever validated (never committed) never leaves behind lots nobody asked
 * for.
 */
export declare function validateImportRow(ctx: TenantContext, type: ImportType, raw: RawImportRow): Promise<RowValidationResult>;
