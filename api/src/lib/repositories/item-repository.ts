// ADR-002 / Week 4: the Catalog repository for Item. Every exported function
// requires a TenantContext as its first argument - not optional, not
// inferred from a route param - and every query it runs is scoped by
// ctx.companyId. Callers cannot "forget" to scope a query the way
// lib/item-master-service.ts's old requireItem() did (it looked an item up
// by id alone, with no ownership check at all - the exact defect this
// repository exists to make structurally impossible to repeat).
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { itemsForCompany, ownerOfItem } from '../saas/tenant-scope.js';
import { itemRowToRecord } from '../item-record-mapper.js';
import { items as memoryItems, type ItemRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

/** mrp is Decimal(14,2) in the database; item records (and the API built on them) carry a plain number. */
function toItemRecord(row: { mrp?: unknown }): ItemRecord {
  return { ...row, mrp: row.mrp == null ? undefined : Number(row.mrp) } as unknown as ItemRecord;
}

export class ItemNotFoundError extends Error {
  constructor(itemId: string) {
    // Deliberately the same message/shape whether the item does not exist at
    // all or belongs to a different tenant - a wrong-tenant lookup must not
    // be distinguishable from a genuinely missing item.
    super(`Item ${itemId} was not found.`);
    this.name = 'ItemNotFoundError';
  }
}

/** Scoped lookup: returns the item only if it belongs to ctx.companyId, never leaking existence across tenants. */
export async function findItemById(ctx: TenantContext, itemId: string): Promise<ItemRecord | null> {
  if (databaseEnabled) {
    const row = await prisma.item.findFirst({ where: { id: itemId, companyId: ctx.companyId } });
    return row ? toItemRecord(row) : null;
  }
  if (ownerOfItem(itemId) !== ctx.companyId) return null;
  return memoryItems.find((item) => item.id === itemId) ?? null;
}

/** Same as findItemById but throws, for call sites that treat "not mine" the same as "does not exist". */
export async function requireItemById(ctx: TenantContext, itemId: string): Promise<ItemRecord> {
  const item = await findItemById(ctx, itemId);
  if (!item) throw new ItemNotFoundError(itemId);
  return item;
}

export async function listItems(ctx: TenantContext, filter: { status?: string } = {}): Promise<ItemRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.item.findMany({ where: { companyId: ctx.companyId, ...(filter.status ? { status: filter.status } : {}) } });
    return rows.map(toItemRecord);
  }
  return memoryItems.filter((item) => ownerOfItem(item.id) === ctx.companyId && (!filter.status || item.status === filter.status));
}

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
export async function searchItems(ctx: TenantContext, filter: ItemSearchFilter = {}): Promise<ItemSearchPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
  const search = filter.search?.trim();

  if (databaseEnabled) {
    const rows = await prisma.item.findMany({
      where: {
        companyId: ctx.companyId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search, mode: 'insensitive' as const } }] }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: page.map(toItemRecord), nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  const matches = memoryItems
    .filter((item) => ownerOfItem(item.id) === ctx.companyId)
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
export async function assertItemOwnedByTenant(ctx: TenantContext, itemId: string): Promise<void> {
  if (!databaseEnabled) {
    if (ownerOfItem(itemId) !== ctx.companyId) throw new ItemNotFoundError(itemId);
    return;
  }
  const owned = await prisma.item.findFirst({ where: { id: itemId, companyId: ctx.companyId }, select: { id: true } });
  if (!owned) throw new ItemNotFoundError(itemId);
}

/**
 * A cheap fingerprint of the company's catalogue (items and their lots): row counts plus the newest updatedAt of
 * each. A client that already holds the catalogue compares it with the version it last loaded and refetches the
 * (large) catalogue only when it changed. Deleting a row changes a count; every write path bumps updatedAt
 * (Prisma @updatedAt, and the one raw lot update sets it explicitly). Memory mode has no cheap reliable
 * fingerprint, so it returns null and clients simply refetch, as they did before this existed.
 */
export async function getCatalogueVersion(ctx: TenantContext): Promise<string | null> {
  if (!databaseEnabled) return null;
  const [items, lots] = await Promise.all([
    prisma.item.aggregate({ where: { companyId: ctx.companyId }, _count: { _all: true }, _max: { updatedAt: true } }),
    prisma.lot.aggregate({ where: { item: { companyId: ctx.companyId } }, _count: { _all: true }, _max: { updatedAt: true } }),
  ]);
  const stamp = (value: Date | null) => (value ? value.getTime() : 0);
  return `${items._count._all}.${stamp(items._max.updatedAt)}.${lots._count._all}.${stamp(lots._max.updatedAt)}`;
}

/**
 * Database-first slice 6 (docs/db-first-reads-plan.md): the company's whole catalogue (items with lots), oldest first.
 * Rows go through the same mapper snapshot hydration uses, so the shape is identical to the in-memory records.
 * Callers that hold the catalogue should gate this behind getCatalogueVersion; it is a large read.
 */
export async function listItemsForCompany(ctx: TenantContext): Promise<ItemRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.item.findMany({
      where: { companyId: ctx.companyId },
      include: { lots: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(itemRowToRecord);
  }
  return itemsForCompany(ctx.companyId, memoryItems);
}
