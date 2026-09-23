"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockDetail = getStockDetail;
// Week 10: read models for the Item Detail / Stock Detail vertical slice.
// Every function here reads the canonical journal/projection
// (StockMovement + StockLedger, ADR-001) - never a separately-maintained
// summary table - so "reconciliation status" is computed the same way
// scripts/reconcile-stock-journal.mjs (Week 6) already computes it, not a
// second implementation of the same idea that could drift from it.
const db_js_1 = require("./db.js");
const item_repository_js_1 = require("./repositories/item-repository.js");
const TOLERANCE = 1e-6;
/**
 * Everything Item Detail needs in one server round trip: per-location
 * balances, lot/expiry state, recent movement history and a per-(lot,
 * location) reconciliation status - all derived from StockLedger/
 * StockMovement, never from a client-maintained running total.
 */
async function getStockDetail(ctx, itemId, movementLimit = 50) {
    const item = await (0, item_repository_js_1.requireItemById)(ctx, itemId);
    const [ledgerRows, lots, movements] = await Promise.all([
        db_js_1.prisma.stockLedger.findMany({
            where: { itemId, companyId: ctx.companyId },
            include: { location: { select: { id: true, name: true } } },
        }),
        db_js_1.prisma.lot.findMany({ where: { itemId } }),
        db_js_1.prisma.stockMovement.findMany({
            where: { itemId, companyId: ctx.companyId },
            orderBy: { timestamp: 'desc' },
            take: movementLimit,
        }),
    ]);
    const branchByLocation = new Map();
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
        existing.onHand += row.onHand;
        existing.reserved += row.reserved;
        existing.quarantine += row.quarantine;
        existing.damaged += row.damaged;
        existing.available = existing.onHand - existing.reserved;
        branchByLocation.set(row.locationId, existing);
    }
    const onHandByLot = new Map();
    for (const row of ledgerRows)
        onHandByLot.set(row.lotId, (onHandByLot.get(row.lotId) ?? 0) + row.onHand);
    const lotDetails = lots.map((lot) => ({
        lotId: lot.id,
        lotNo: lot.lotNo,
        expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
        status: lot.status,
        totalOnHand: onHandByLot.get(lot.id) ?? 0,
    }));
    const movementRows = movements.map((movement) => ({
        id: movement.id,
        movementType: movement.movementType,
        qtyDelta: movement.qtyDelta,
        beforeBalance: movement.beforeBalance,
        afterBalance: movement.afterBalance,
        locationId: movement.locationId,
        lotId: movement.lotId,
        reason: movement.reason,
        sourceDocument: movement.sourceDocument,
        actor: movement.actor,
        timestamp: movement.timestamp.toISOString(),
        reversalOf: movement.metadata?.reversalOf ?? null,
    }));
    const reconciliation = await Promise.all(ledgerRows.map(async (row) => {
        const sums = await db_js_1.prisma.stockMovement.aggregate({
            where: { itemId, lotId: row.lotId, locationId: row.locationId, companyId: ctx.companyId },
            _sum: { qtyDelta: true },
        });
        const journalSum = sums._sum.qtyDelta ?? 0;
        const delta = row.onHand - journalSum;
        return { explained: Math.abs(delta) <= TOLERANCE, journalSum, onHand: row.onHand, delta };
    }));
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
