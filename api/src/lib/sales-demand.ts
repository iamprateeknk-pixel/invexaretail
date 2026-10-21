// One source of sales demand (audit O-2). Sales reach the database by two disjoint paths: order
// fulfilment and the staged import write StockMovement (SALES_DEDUCTION / SALES_RETURN); the legacy
// daily ERP import (/imports/sales/*) writes InventoryMovement (SALE_OUT / SALES_RETURN) and never
// a StockMovement. Forecasts that read only the first saw NO demand for stores fed by the second.
// The two never record the same sale, so their union is the demand; nothing is double counted.
import { prisma } from './db.js';

export type SalesEvent = {
  itemId: string;
  /** Net units: a sale is positive, a return is negative. */
  qty: number;
  timestamp: Date;
};

export function signedSalesQty(movementType: string, qtyDelta: number): number {
  return movementType === 'SALES_RETURN' ? -Math.abs(qtyDelta) : Math.abs(qtyDelta);
}

export async function loadSalesEvents(input: {
  since: Date;
  companyId?: string;
  locationId?: string;
  itemIds?: string[];
  limit?: number;
}): Promise<SalesEvent[]> {
  const limit = input.limit ?? 50_000;
  const [current, legacy] = await Promise.all([
    prisma.stockMovement.findMany({
      where: {
        movementType: { in: ['SALES_DEDUCTION', 'SALES_RETURN'] }, timestamp: { gte: input.since },
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.itemIds ? { itemId: { in: input.itemIds } } : {}),
      },
      select: { itemId: true, qtyDelta: true, timestamp: true, movementType: true },
      take: limit,
    }),
    prisma.inventoryMovement.findMany({
      where: {
        movementType: { in: ['SALE_OUT', 'SALES_RETURN'] }, transactionAt: { gte: input.since },
        ...(input.companyId ? { location: { companyId: input.companyId } } : {}),
        ...(input.locationId ? { locationId: input.locationId } : {}),
        ...(input.itemIds ? { itemId: { in: input.itemIds } } : {}),
      },
      select: { itemId: true, qtyDelta: true, transactionAt: true, movementType: true },
      take: limit,
    }).catch(() => []),
  ]);
  return [
    ...current.map((row) => ({ itemId: row.itemId, qty: signedSalesQty(row.movementType, Number(row.qtyDelta)), timestamp: row.timestamp })),
    ...legacy.map((row) => ({ itemId: row.itemId, qty: signedSalesQty(row.movementType, Number(row.qtyDelta)), timestamp: row.transactionAt })),
  ];
}

/** Total net units sold per item. */
export function totalsByItem(events: SalesEvent[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const event of events) totals.set(event.itemId, (totals.get(event.itemId) ?? 0) + event.qty);
  return totals;
}
