import { isExpiredOn } from './expiry-date.js';

// Audit O-6: replenishment and forecasting counted GROSS on-hand as cover, so lots that
// are BLOCKED, quarantined or already past their expiry - stock nobody can sell - made an
// item look covered and suppressed a needed reorder. Cover is what can actually be sold:
// AVAILABLE, unexpired lots, minus what is already reserved.

export type SellableRow = {
  onHand: number;
  reserved?: number;
  lot?: { status?: string | null; expiryDate?: Date | string | null } | null;
};

export function sellableQuantity(row: SellableRow, now: Date = new Date()): number {
  const status = row.lot?.status ?? 'AVAILABLE';
  if (status !== 'AVAILABLE') return 0;
  if (isExpiredOn(row.lot?.expiryDate ?? null, now)) return 0;
  return Math.max(0, row.onHand - Math.max(0, row.reserved ?? 0));
}

export function totalSellable(rows: SellableRow[], now: Date = new Date()): number {
  return rows.reduce((sum, row) => sum + sellableQuantity(row, now), 0);
}

/** On-hand and reserved restricted to lots that can be sold (for callers that show both). */
export function sellableParts(rows: SellableRow[], now: Date = new Date()): { onHand: number; reserved: number } {
  let onHand = 0;
  let reserved = 0;
  for (const row of rows) {
    if ((row.lot?.status ?? 'AVAILABLE') !== 'AVAILABLE' || isExpiredOn(row.lot?.expiryDate ?? null, now)) continue;
    onHand += row.onHand;
    reserved += Math.max(0, row.reserved ?? 0);
  }
  return { onHand, reserved };
}
