import { type ItemReferenceCounts, type ItemStatus } from './item-master.js';
import type { TenantContext } from './tenant-context.js';
export declare class ItemMasterError extends Error {
    readonly status: number;
    readonly blockers?: Array<{
        key: string;
        label: string;
        count: number;
    }>;
    constructor(message: string, status?: number, blockers?: Array<{
        key: string;
        label: string;
        count: number;
    }>);
}
/**
 * How much history an item has. In database mode the database is the source
 * of truth (the in-memory movement list is capped); in memory mode the
 * in-memory records are.
 */
export declare function referenceCounts(itemId: string): Promise<ItemReferenceCounts>;
/** Archive / deactivate / reactivate. History is untouched; the item just leaves operational use. */
export declare function changeItemStatus(ctx: TenantContext, itemId: string, change: {
    status: ItemStatus;
    reason?: string;
}): Promise<{
    item: import("./repository.js").ItemRecord;
    changed: boolean;
}>;
/**
 * Permanent delete is only for an item that never took part in anything.
 * With any history the item must be archived instead, so reports can still
 * explain what happened.
 */
export declare function deleteItemPermanently(ctx: TenantContext, itemId: string): Promise<void>;
