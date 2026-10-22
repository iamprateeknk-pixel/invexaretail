// Phase 5 (DB-first stock reads, R1/R4) — the stock read side, scoped by
// TenantContext like every other repository here (ADR-002). In database
// mode these functions read the StockLedger / BinStock / StockMovement
// tables directly; in memory mode they read the snapshot through the same
// ownership map the rest of the request path already trusts. This is
// docs/db-first-reads-plan.md's step 3 ("stock reads — the largest memory
// user and the most write-contended"), executed per phase5_plan.md §4.
//
// Balances come from the StockLedger projection (ADR-001), never recomputed
// from the journal on a request path; the journal is read only for the one
// genuinely temporal question here — which items moved recently
// (listRecentMovementItemIds). There is deliberately no caching layer: the
// snapshot was the cache, and replacing it with another one would
// re-create R4.
import { prisma } from '../db.js';
import { databaseEnabled } from '../persistence.js';
import { companyOwnsLocation } from '../saas/tenant-scope.js';
import {
  findStockLedgerEntry,
  items as memoryItems,
  listStockLedger,
  listStockLedgerForLocation,
  listStockMovements,
  type StockLedgerRecord,
} from '../repository.js';
import { ledgerRowToRecord } from '../stock-ledger-mapper.js';
import { memoryBinStock } from '../bin-stock.js';
import type { TenantContext } from '../tenant-context.js';
import type { StockMovementType } from '@prisma/client';

/** Every stock row at one of the company's locations, ordered by item then lot (the snapshot has no order contract; identity is the tuple). */
export async function listStockForLocation(ctx: TenantContext, locationId: string): Promise<StockLedgerRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.stockLedger.findMany({
      where: { companyId: ctx.companyId, locationId },
      orderBy: [{ itemId: 'asc' }, { lotId: 'asc' }],
    });
    return rows.map(ledgerRowToRecord);
  }
  if (!companyOwnsLocation(ctx.companyId, locationId)) return [];
  return listStockLedgerForLocation(locationId);
}

/** One stock row by its tenant-qualified key, or null — a foreign company's tuple is indistinguishable from a missing one. */
export async function findStockEntry(ctx: TenantContext, itemId: string, lotId: string, locationId: string): Promise<StockLedgerRecord | null> {
  if (databaseEnabled) {
    const row = await prisma.stockLedger.findUnique({
      where: { companyId_itemId_lotId_locationId: { companyId: ctx.companyId, itemId, lotId, locationId } },
    });
    return row ? ledgerRowToRecord(row) : null;
  }
  if (!companyOwnsLocation(ctx.companyId, locationId)) return null;
  return findStockLedgerEntry(itemId, lotId, locationId) ?? null;
}

/**
 * The company's whole ledger, all locations. This is a bounded read (one
 * tenant), not an unbounded one — the snapshot it replaces held every
 * company's rows in process memory. Callers that only need totals should
 * aggregate instead of mapping this into a report by hand where practical.
 */
export async function listStockForCompany(ctx: TenantContext): Promise<StockLedgerRecord[]> {
  if (databaseEnabled) {
    const rows = await prisma.stockLedger.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ locationId: 'asc' }, { itemId: 'asc' }, { lotId: 'asc' }],
    });
    return rows.map(ledgerRowToRecord);
  }
  return listStockLedger().filter((row) => companyOwnsLocation(ctx.companyId, row.locationId));
}

/**
 * Which items have journal movements at a location (optionally of one type,
 * optionally since a moment) — the count-assignment recency signal. This
 * replaces reads of the snapshot's stockMovements array, which is never
 * hydrated and silently empties on every restart (phase5 plan §1.1).
 */
export async function listRecentMovementItemIds(
  ctx: TenantContext,
  filter: { locationId: string; movementType?: string; since?: Date },
): Promise<string[]> {
  if (databaseEnabled) {
    const rows = await prisma.stockMovement.findMany({
      where: {
        companyId: ctx.companyId,
        locationId: filter.locationId,
        ...(filter.movementType ? { movementType: filter.movementType as StockMovementType } : {}),
        ...(filter.since ? { timestamp: { gte: filter.since } } : {}),
      },
      select: { itemId: true },
      distinct: ['itemId'],
    });
    return rows.map((row) => row.itemId);
  }
  if (!companyOwnsLocation(ctx.companyId, filter.locationId)) return [];
  const sinceIso = filter.since?.toISOString();
  const ids = new Set<string>();
  for (const movement of listStockMovements({ locationId: filter.locationId })) {
    if (filter.movementType && movement.movementType !== filter.movementType) continue;
    if (sinceIso && movement.timestamp < sinceIso) continue;
    ids.add(movement.itemId);
  }
  return [...ids];
}

export type RecentMovementRow = { itemId: string; movementType: string; qtyDelta: number; timestamp: string };

/**
 * Journal rows at a location (oldest first), optionally narrowed by type
 * and start time — the quantity-bearing sibling of
 * listRecentMovementItemIds, for callers like the cycle-count planner that
 * sum signed sales quantities. Same contract: the journal, never the
 * snapshot's never-hydrated array.
 */
export async function listRecentMovements(
  ctx: TenantContext,
  filter: { locationId: string; movementTypes?: string[]; since?: Date },
): Promise<RecentMovementRow[]> {
  if (databaseEnabled) {
    const rows = await prisma.stockMovement.findMany({
      where: {
        companyId: ctx.companyId,
        locationId: filter.locationId,
        ...(filter.movementTypes?.length ? { movementType: { in: filter.movementTypes as StockMovementType[] } } : {}),
        ...(filter.since ? { timestamp: { gte: filter.since } } : {}),
      },
      select: { itemId: true, movementType: true, qtyDelta: true, timestamp: true },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      itemId: row.itemId,
      movementType: row.movementType as string,
      qtyDelta: Number(row.qtyDelta),
      timestamp: row.timestamp.toISOString(),
    }));
  }
  if (!companyOwnsLocation(ctx.companyId, filter.locationId)) return [];
  const sinceIso = filter.since?.toISOString();
  return listStockMovements({ locationId: filter.locationId })
    .filter((movement) => !filter.movementTypes?.length || filter.movementTypes.includes(movement.movementType))
    .filter((movement) => !sinceIso || movement.timestamp >= sinceIso)
    .map((movement) => ({ itemId: movement.itemId, movementType: movement.movementType, qtyDelta: movement.qtyDelta, timestamp: movement.timestamp }));
}

export type BinStockRow = {
  itemId: string;
  lotId: string | null;
  locationId: string;
  binId: string;
  onHand: number;
  reserved: number;
  item: { id: string; code: string; name: string };
  // Database rows carry their projection bookkeeping; the memory bin ledger
  // has no equivalent, so these are present in database mode only — the same
  // asymmetry the route's two branches have always had.
  id?: string;
  tenantId?: string;
  companyId?: string;
  version?: number;
  updatedAt?: Date;
  location?: { id: string; name: string };
};

/**
 * Bin-level stock at one location (positive on-hand only, capped at 500 —
 * the shape GET /locations/:locationId/bin-stock has always served from its
 * database branch, formalised here by Phase 5 step 3: the full row with
 * numeric buckets and the item/location joins). The memory branch returns
 * the bin ledger's own view and deliberately does NOT seed it from the
 * stock snapshot: that side effect inside a read was plan §2.5b's defect,
 * and in database mode this function never touches process memory.
 */
export async function listBinStockForLocation(ctx: TenantContext, locationId: string): Promise<BinStockRow[]> {
  if (databaseEnabled) {
    const rows = await prisma.binStock.findMany({
      where: { companyId: ctx.companyId, locationId, onHand: { gt: 0 } },
      include: { item: { select: { id: true, code: true, name: true } }, location: { select: { id: true, name: true } } },
      orderBy: [{ binId: 'asc' }, { itemId: 'asc' }],
      take: 500,
    });
    return rows.map((row) => ({ ...row, onHand: Number(row.onHand), reserved: Number(row.reserved) }));
  }
  if (!companyOwnsLocation(ctx.companyId, locationId)) return [];
  return memoryBinStock
    .list({ locationId })
    .filter((row) => row.onHand > 0)
    .map((row) => {
      const item = memoryItems.find((candidate) => candidate.id === row.itemId);
      return {
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        binId: row.binId,
        onHand: row.onHand,
        reserved: row.reserved,
        item: item ? { id: item.id, code: item.code, name: item.name } : { id: row.itemId, code: row.itemId, name: row.itemId },
      };
    });
}
