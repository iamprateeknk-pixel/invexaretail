"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ItemNotFoundError = void 0;
exports.findItemById = findItemById;
exports.requireItemById = requireItemById;
exports.listItems = listItems;
exports.searchItems = searchItems;
exports.assertItemOwnedByTenant = assertItemOwnedByTenant;
// ADR-002 / Week 4: the Catalog repository for Item. Every exported function
// requires a TenantContext as its first argument - not optional, not
// inferred from a route param - and every query it runs is scoped by
// ctx.companyId. Callers cannot "forget" to scope a query the way
// lib/item-master-service.ts's old requireItem() did (it looked an item up
// by id alone, with no ownership check at all - the exact defect this
// repository exists to make structurally impossible to repeat).
const db_js_1 = require("../db.js");
const persistence_js_1 = require("../persistence.js");
const tenant_scope_js_1 = require("../saas/tenant-scope.js");
const repository_js_1 = require("../repository.js");
class ItemNotFoundError extends Error {
    constructor(itemId) {
        // Deliberately the same message/shape whether the item does not exist at
        // all or belongs to a different tenant - a wrong-tenant lookup must not
        // be distinguishable from a genuinely missing item.
        super(`Item ${itemId} was not found.`);
        this.name = 'ItemNotFoundError';
    }
}
exports.ItemNotFoundError = ItemNotFoundError;
/** Scoped lookup: returns the item only if it belongs to ctx.companyId, never leaking existence across tenants. */
async function findItemById(ctx, itemId) {
    if (persistence_js_1.databaseEnabled) {
        const row = await db_js_1.prisma.item.findFirst({ where: { id: itemId, companyId: ctx.companyId } });
        return row;
    }
    if ((0, tenant_scope_js_1.ownerOfItem)(itemId) !== ctx.companyId)
        return null;
    return repository_js_1.items.find((item) => item.id === itemId) ?? null;
}
/** Same as findItemById but throws, for call sites that treat "not mine" the same as "does not exist". */
async function requireItemById(ctx, itemId) {
    const item = await findItemById(ctx, itemId);
    if (!item)
        throw new ItemNotFoundError(itemId);
    return item;
}
async function listItems(ctx, filter = {}) {
    if (persistence_js_1.databaseEnabled) {
        const rows = await db_js_1.prisma.item.findMany({ where: { companyId: ctx.companyId, ...(filter.status ? { status: filter.status } : {}) } });
        return rows;
    }
    return repository_js_1.items.filter((item) => (0, tenant_scope_js_1.ownerOfItem)(item.id) === ctx.companyId && (!filter.status || item.status === filter.status));
}
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 25;
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
async function searchItems(ctx, filter = {}) {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const search = filter.search?.trim();
    if (persistence_js_1.databaseEnabled) {
        const rows = await db_js_1.prisma.item.findMany({
            where: {
                companyId: ctx.companyId,
                ...(filter.status ? { status: filter.status } : {}),
                ...(search
                    ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] }
                    : {}),
            },
            orderBy: { id: 'asc' },
            take: limit + 1,
            ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    }
    const matches = repository_js_1.items
        .filter((item) => (0, tenant_scope_js_1.ownerOfItem)(item.id) === ctx.companyId)
        .filter((item) => !filter.status || item.status === filter.status)
        .filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.code.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const startIndex = filter.cursor ? matches.findIndex((item) => item.id === filter.cursor) + 1 : 0;
    const page = matches.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < matches.length;
    return { items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
}
/**
 * Guard for a mutation (status change, delete) that the caller implements
 * elsewhere but must not run before confirming tenant ownership. Throws
 * ItemNotFoundError - the same shape as a genuinely missing item - rather
 * than returning a boolean a caller could accidentally ignore.
 */
async function assertItemOwnedByTenant(ctx, itemId) {
    if (!persistence_js_1.databaseEnabled) {
        if ((0, tenant_scope_js_1.ownerOfItem)(itemId) !== ctx.companyId)
            throw new ItemNotFoundError(itemId);
        return;
    }
    const owned = await db_js_1.prisma.item.findFirst({ where: { id: itemId, companyId: ctx.companyId }, select: { id: true } });
    if (!owned)
        throw new ItemNotFoundError(itemId);
}
