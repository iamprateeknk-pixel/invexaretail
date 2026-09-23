import type { TenantContext } from './tenant-context.js';
export declare const HO_LOCATION_NAME = "HO Basni";
export type ImportType = 'PURCHASE' | 'SALES' | 'SALES_RETURN' | 'OPENING_STOCK';
export declare const IMPORT_TYPE_POLICY: Record<ImportType, 'ALL_OR_NOTHING' | 'PARTIAL_SUCCESS'>;
export declare class HoLocationNotConfiguredError extends Error {
    constructor(companyId: string);
}
export declare class BranchNotFoundError extends Error {
    constructor(branchName: string);
}
export declare class InvalidQuantityError extends Error {
    constructor(raw: unknown);
}
/** Purchases always land at Head Office, regardless of what branch the row names - resolved once per batch, not per row, since it never varies within a company. */
export declare function resolvePurchaseLocation(ctx: TenantContext): Promise<{
    name: string;
    companyId: string;
    code: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    type: string;
    branchId: string | null;
    description: string | null;
    locationType: string | null;
    parentId: string | null;
    latitude: number | null;
    longitude: number | null;
    deliverySlaHours: number | null;
    shippingCostPerKm: number | null;
}>;
/** Sales and sales returns route by the row's own Branch Name field. */
export declare function resolveBranchLocation(ctx: TenantContext, branchName: string): Promise<{
    name: string;
    companyId: string;
    code: string;
    id: string;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    type: string;
    branchId: string | null;
    description: string | null;
    locationType: string | null;
    parentId: string | null;
    latitude: number | null;
    longitude: number | null;
    deliverySlaHours: number | null;
    shippingCostPerKm: number | null;
}>;
/**
 * Strict numeric parsing - rejects anything that isn't a finite, real
 * quantity (blank, text, Infinity, NaN) rather than coercing it to 0 and
 * silently posting a zero-quantity movement. `Float` remains the schema
 * type for quantity (ADR-004's Decimal migration is prepared, per
 * docs/decimal-migration-plan.md, but not executed) - this is strict
 * validation of that Float, not a true arbitrary-precision Decimal parse.
 */
export declare function parseImportQuantity(raw: unknown): number;
/**
 * Finds or creates the lot for this item, relying on Lot's own
 * `@@unique([itemId, lotNo])` constraint to make two concurrent imports
 * racing to create "the same" lot resolve to one row, not two - a
 * duplicate-key error on create is caught and re-read as the winner.
 */
export declare function resolveLotForItem(itemId: string, lotNo: string, expiryDate?: Date | null): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    itemId: string;
    expiryDate: Date | null;
    lotNo: string;
    attributes: import("@prisma/client/runtime/client").JsonValue | null;
}>;
/**
 * A row is "late" if its transaction time is before this location's
 * recorded sync checkpoint for this source type - meaning data for a
 * period already considered settled just arrived. Policy: still post it
 * (never silently drop real stock movement), just flag it - callers mark
 * the row's warnings with `LATE_MOVEMENT` and must never use a late row's
 * transactionAt to move the checkpoint backwards (see
 * `advanceSyncCheckpoint`).
 */
export declare function isLateMovement(locationId: string, sourceType: string, transactionAt: Date): Promise<boolean>;
/** Advances a location's sync checkpoint forward only - a late row committed after the checkpoint already passed it must never pull the checkpoint backward. */
export declare function advanceSyncCheckpoint(locationId: string, sourceType: string, throughAt: Date, importBatchId: string): Promise<void>;
