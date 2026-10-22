// Week 10: read models for the Item Detail / Stock Detail vertical slice.
// Every function here reads the canonical journal/projection
// (StockMovement + StockLedger, ADR-001) - never a separately-maintained
// summary table - so "reconciliation status" is computed the same way
// scripts/reconcile-stock-journal.mjs (Week 6) already computes it, not a
// second implementation of the same idea that could drift from it.
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';
import { requireItemById } from './repositories/item-repository.js';

export type BranchBalance = {
  locationId: string;
  locationName: string;
  onHand: number;
  reserved: number;
  quarantine: number;
  damaged: number;
  available: number;
};

export type LotDetail = {
  lotId: string;
  lotNo: string;
  expiryDate: string | null;
  status: string;
  totalOnHand: number;
};

export type MovementRow = {
  id: string;
  movementType: string;
  qtyDelta: number;
  beforeBalance: number;
  afterBalance: number;
  locationId: string;
  lotId: string | null;
  reason: string | null;
  sourceDocument: string | null;
  actor: string | null;
  timestamp: string;
  reversalOf: string | null;
};

export type ReconciliationStatus = {
  explained: boolean;
  journalSum: number;
  onHand: number;
  delta: number;
};

export type StockDetail = {
  itemId: string;
  itemCode: string;
  itemName: string;
  branches: BranchBalance[];
  lots: LotDetail[];
  movements: MovementRow[];
  reconciliation: ReconciliationStatus[];
};

const TOLERANCE = 1e-6;

/**
 * Everything Item Detail needs in one server round trip: per-location
 * balances, lot/expiry state, recent movement history and a per-(lot,
 * location) reconciliation status - all derived from StockLedger/
 * StockMovement, never from a client-maintained running total.
 */
export async function getStockDetail(ctx: TenantContext, itemId: string, movementLimit = 50): Promise<StockDetail> {
  const item = await requireItemById(ctx, itemId);

  const [ledgerRows, lots, movements] = await Promise.all([
    prisma.stockLedger.findMany({
      where: { itemId, companyId: ctx.companyId },
      include: { location: { select: { id: true, name: true } } },
    }),
    prisma.lot.findMany({ where: { itemId } }),
    prisma.stockMovement.findMany({
      where: { itemId, companyId: ctx.companyId },
      orderBy: { timestamp: 'desc' },
      take: movementLimit,
    }),
  ]);

  const branchByLocation = new Map<string, BranchBalance>();
  for (const row of ledgerRows) {
    const existing = branchByLocation.get(row.locationId) ?? {
      locationId: row.locationId,
      locationName: row.location.name,
      onHand: 0,
      reserved: 0,
      quarantine: 0,
      damaged: 0,
      available: 0,
    };
    existing.onHand += Number(row.onHand);
    existing.reserved += Number(row.reserved);
    existing.quarantine += Number(row.quarantine);
    existing.damaged += Number(row.damaged);
    existing.available = existing.onHand - existing.reserved;
    branchByLocation.set(row.locationId, existing);
  }

  const onHandByLot = new Map<string, number>();
  for (const row of ledgerRows) onHandByLot.set(row.lotId, (onHandByLot.get(row.lotId) ?? 0) + Number(row.onHand));

  const lotDetails: LotDetail[] = lots.map((lot) => ({
    lotId: lot.id,
    lotNo: lot.lotNo,
    expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
    status: lot.status,
    totalOnHand: onHandByLot.get(lot.id) ?? 0,
  }));

  const movementRows: MovementRow[] = movements.map((movement) => ({
    id: movement.id,
    movementType: movement.movementType,
    qtyDelta: Number(movement.qtyDelta),
    beforeBalance: Number(movement.beforeBalance),
    afterBalance: Number(movement.afterBalance),
    locationId: movement.locationId,
    lotId: movement.lotId,
    reason: movement.reason,
    sourceDocument: movement.sourceDocument,
    actor: movement.actor,
    timestamp: movement.timestamp.toISOString(),
    reversalOf: (movement.metadata as { reversalOf?: string } | null)?.reversalOf ?? null,
  }));

  const reconciliation = await Promise.all(
    ledgerRows.map(async (row): Promise<ReconciliationStatus> => {
      const sums = await prisma.stockMovement.aggregate({
        where: { itemId, lotId: row.lotId, locationId: row.locationId, companyId: ctx.companyId },
        _sum: { qtyDelta: true },
      });
      const journalSum = Number(sums._sum.qtyDelta ?? 0);
      const delta = Number(row.onHand) - journalSum;
      return { explained: Math.abs(delta) <= TOLERANCE, journalSum, onHand: Number(row.onHand), delta };
    }),
  );

  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    branches: [...branchByLocation.values()],
    lots: lotDetails,
    movements: movementRows,
    reconciliation,
  };
}
