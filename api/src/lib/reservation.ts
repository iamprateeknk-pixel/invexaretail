import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';

// Blueprint section 7.2 (inventory state model) + §9 (Store Replenishment &
// Transfers): "Available = On Hand - Reserved". Today `StockLedger.reserved`
// exists in the schema but nothing ever writes to it, so two concurrent
// transfer requests against the same low-stock lot can both be created -
// only the pick step later discovers the shortfall, one transfer at a time.
// This closes that gap at the point it actually happens: reserve on
// request, release on the transfer reaching any terminal state.

export class InsufficientStockError extends Error {}

export type ReserveLine = { itemId: string; lotId: string; locationId: string; quantity: number };

/**
 * Atomically reserves every line or none of them, checking `onHand -
 * reserved` per line inside one transaction so two concurrent requests for
 * the same lot cannot both succeed. DB-backed only: memory-mode
 * deployments are single-process demo/dev use and have no real concurrent
 * requests to race, so this is a no-op there (consistent with every other
 * DB-only enhancement in this pass - Exception Inbox, putaway, pick waves).
 */
export async function reserveStockForTransfer(lines: ReserveLine[]): Promise<void> {
  if (!databaseEnabled || !lines.length) return;
  await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      const ledger = await tx.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
      });
      const available = (ledger?.onHand ?? 0) - (ledger?.reserved ?? 0);
      if (available < line.quantity - 1e-8) {
        throw new InsufficientStockError(
          `Only ${Math.max(0, available)} units are available for lot ${line.lotId} at this location - ${line.quantity} were requested.`,
        );
      }
    }
    for (const line of lines) {
      await tx.stockLedger.update({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
        data: { reserved: { increment: line.quantity }, version: { increment: 1 } },
      });
    }
  });
}

/**
 * Releases previously reserved quantity when a transfer reaches a terminal
 * state (confirmed, cancelled, rejected, closed). Never throws and clamps
 * at zero: a reservation-bookkeeping failure or drift must not block the
 * status change it is cleaning up after, and the physical stock movement
 * (if any) has already been posted elsewhere by the time this runs.
 */
export async function releaseReservedStock(lines: ReserveLine[]): Promise<void> {
  if (!databaseEnabled || !lines.length) return;
  for (const line of lines) {
    try {
      const ledger = await prisma.stockLedger.findUnique({
        where: { itemId_lotId_locationId: { itemId: line.itemId, lotId: line.lotId, locationId: line.locationId } },
      });
      if (!ledger) continue;
      await prisma.stockLedger.update({
        where: { id: ledger.id },
        data: { reserved: Math.max(0, ledger.reserved - line.quantity), version: { increment: 1 } },
      });
    } catch (error) {
      console.error('releaseReservedStock failed (non-blocking):', error instanceof Error ? error.message : error);
    }
  }
}

export const TERMINAL_TRANSFER_STATUSES = ['CONFIRMED', 'REJECTED', 'CANCELLED', 'CLOSED'] as const;
