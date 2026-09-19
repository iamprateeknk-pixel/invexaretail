import { orderLots } from './weight-allocation.js';

// Blueprint v4 §15 Warehouse picking - KG loose: "Select item, enter requested
// KG; backend allocates lots FIFO/FEFO", "No zero-stock lot offered", "No
// manual lot splitting by picker". The picker states a weight; this decides
// which lots it comes from. A lot that is blocked, expired, quarantined or
// empty is never used, and the picker is told plainly when the shelf cannot
// cover the request instead of being handed a short pick silently.

export type PickLot = {
  lotId: string;
  lotNo: string;
  // On hand here, minus what earlier slips of this same transfer already took.
  available: number;
  expiryDate?: string | null;
  status?: 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE';
};

export type PickAllocation = { lotId: string; lotNo: string; quantity: number; expiryDate?: string | null };

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** A lot a picker may take from: available status, stock on the shelf, and not past its expiry. */
export function isPickableLot(lot: Pick<PickLot, 'status' | 'available' | 'expiryDate'>, today = new Date()): boolean {
  if ((lot.status ?? 'AVAILABLE') !== 'AVAILABLE') return false;
  if (!(lot.available > 0)) return false;
  if (lot.expiryDate && Date.parse(lot.expiryDate) < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) return false;
  return true;
}

export function allocatePick(input: { requested: number; lots: PickLot[]; strategy: 'FIFO' | 'FEFO'; today?: Date }): { allocations: PickAllocation[]; shortfall: number } {
  const requested = round3(Number(input.requested));
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('Picked quantity must be greater than zero.');
  const eligible = orderLots(
    input.lots.filter((lot) => isPickableLot(lot, input.today)).map((lot) => ({ lotId: lot.lotId, lotNo: lot.lotNo, bookQty: lot.available, expiryDate: lot.expiryDate, status: 'AVAILABLE' as const })),
    input.strategy,
  );
  let remaining = requested;
  const allocations: PickAllocation[] = [];
  for (const lot of eligible) {
    if (remaining <= 0) break;
    const take = round3(Math.min(remaining, lot.bookQty));
    allocations.push({ lotId: lot.lotId, lotNo: lot.lotNo, quantity: take, expiryDate: lot.expiryDate });
    remaining = round3(remaining - take);
  }
  return { allocations, shortfall: remaining };
}

/** Items picked by weight from the whole pool rather than from one named lot. */
export function isPooledPick(item: { pickMethod?: string | null }): boolean {
  return item.pickMethod === 'ITEM_QTY_FIFO';
}
