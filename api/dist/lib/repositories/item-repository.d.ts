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
/**
 * Guard for a mutation (status change, delete) that the caller implements
 * elsewhere but must not run before confirming tenant ownership. Throws
 * ItemNotFoundError - the same shape as a genuinely missing item - rather
 * than returning a boolean a caller could accidentally ignore.
 */
export declare function assertItemOwnedByTenant(ctx: TenantContext, itemId: string): Promise<void>;
