import { type ItemRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';
export declare class ItemNotFoundError extends Error {
    constructor(itemId: string);
}
/** Scoped lookup: returns the item only if it belongs to ctx.companyId, never leaking existence across tenants. */
export declare function findItemById(ctx: TenantContext, itemId: string): Promise<ItemRecord | null>;
/** Same as findItemById but throws, for call sites that treat "not mine" the same as "does not exist". */
export declare function requireItemById(ctx: TenantContext, itemId: string): Promise<ItemRecord>;
export declare function listItems(ctx: TenantContext, filter?: {
    status?: string;
}): Promise<ItemRecord[]>;
export type ItemSearchFilter = {
    search?: string;
    status?: string;
    /** Opaque cursor from the previous page's `nextCursor` - a raw item id, never re-derived client-side. */
    cursor?: string;
    limit?: number;
};
export type ItemSearchPage = {
    items: ItemRecord[];
    nextCursor: string | null;
};
/**
 * Week 10: server-side cursor pagination for item search. `GET /items`
 * (routes/core.ts) loads a tenant's *entire* item list into memory on every
 * call - fine at seed-data scale, not at the 5,000+ item scale this
 * function is built and tested for
 * (item-repository.postgres.test.ts's pagination suite). Cursor is the
 * last-seen item id (stable `id` ordering), not an offset - an offset
 * re-scans and re-skips every prior row on each page and drifts under
 * concurrent inserts; a cursor does neither.
 */
export declare function searchItems(ctx: TenantContext, filter?: ItemSearchFilter): Promise<ItemSearchPage>;
/**
 * Guard for a mutation (status change, delete) that the caller implements
 * elsewhere but must not run before confirming tenant ownership. Throws
 * ItemNotFoundError - the same shape as a genuinely missing item - rather
 * than returning a boolean a caller could accidentally ignore.
 */
export declare function assertItemOwnedByTenant(ctx: TenantContext, itemId: string): Promise<void>;
