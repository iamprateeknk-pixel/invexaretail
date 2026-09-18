import type { ItemRecord } from './repository.js';
export declare const ITEM_STATUSES: readonly ["ACTIVE", "INACTIVE", "ARCHIVED"];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export declare const MIN_STATUS_REASON = 3;
export declare function itemStatusOf(item: Pick<ItemRecord, 'status'>): ItemStatus;
/** Only ACTIVE items may be offered to operational users or used in new transactions. */
export declare function isOperationalItem(item: Pick<ItemRecord, 'status'>): boolean;
/** Admin/management see everything for maintenance; auditors keep read access to history. */
export declare function seesInactiveItems(role: string): boolean;
export type ItemStatusFilter = ItemStatus | 'all' | 'default';
export declare function parseStatusFilter(value: unknown): ItemStatusFilter;
/**
 * Operational users only ever get ACTIVE items. Privileged roles get every
 * item except archived ones by default (so day-to-day lists stay clean), and
 * can ask for ARCHIVED or all to maintain them.
 */
export declare function visibleItems<T extends Pick<ItemRecord, 'status'>>(role: string, items: T[], filter?: ItemStatusFilter): T[];
export declare function parseStatusChange(body: Record<string, unknown>): {
    status: ItemStatus;
    reason?: string;
};
export declare function normalizeKey(value: unknown): string;
export type ItemMasterFields = Partial<Pick<ItemRecord, 'barcode' | 'hsn' | 'gstRate' | 'mrp' | 'leadTimeDays' | 'shelfLifeDays' | 'aliases'>>;
/** Validates the Item Master commercial/planning/integration fields. Only keys present in the body are returned. */
export declare function parseItemMasterFields(body: Record<string, unknown>): ItemMasterFields;
/**
 * Codes, barcodes and aliases share one namespace: import rows resolve
 * through all three, so two items must never claim the same key.
 */
export declare function findIdentityConflict(items: ItemRecord[], itemId: string, claim: {
    code?: string;
    barcode?: string;
    aliases?: string[];
}): string | null;
export type ItemMatch = {
    item?: ItemRecord;
    via?: 'code' | 'barcode' | 'alias' | 'name';
    ambiguous?: boolean;
};
/**
 * One resolver for every import/scan path (blueprint §10 "Item code/name/ERP
 * alias mapping"): exact code, then barcode, then ERP alias, then a unique
 * name. An archived match is still returned so callers can say "archived"
 * instead of "unknown".
 */
export declare function resolveItemByIdentity(items: ItemRecord[], input: {
    code?: string;
    name?: string;
}): ItemMatch;
export declare const REFERENCE_LABELS: Record<string, string>;
export type ItemReferenceCounts = Partial<Record<keyof typeof REFERENCE_LABELS, number>>;
/** Everything that stops a permanent delete. Empty = safe to delete. */
export declare function deleteBlockers(counts: ItemReferenceCounts): Array<{
    key: string;
    label: string;
    count: number;
}>;
export declare function describeBlockers(blockers: Array<{
    label: string;
    count: number;
}>): string;
