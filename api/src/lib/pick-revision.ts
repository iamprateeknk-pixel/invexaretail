import { createHash } from 'node:crypto';
import type { ItemRecord, StockLedgerRecord, TransferRecord } from './repository.js';
import { isPooledPick } from './kg-pick.js';
import { DomainError } from './errors.js';

export function transferPickChanged() {
  return new DomainError('TRANSFER_PICK_CHANGED', 'The pick task changed. Refresh the transfer and scan its items again.');
}

export function pickRevision(
  transfer: TransferRecord,
  items: ReadonlyMap<string, ItemRecord>,
  ledger: StockLedgerRecord[],
  slipIds: string[],
): string {
  const stock = new Map(ledger.map((row) => [row.lotId, row.onHand]));
  const requestedLots = new Set(transfer.lines.map((line) => line.lotId));
  const itemIds = [...new Set(transfer.lines.map((line) => line.itemId))].sort();
  const catalog = itemIds.map((id) => {
    const item = items.get(id);
    if (!item) return [id, null];
    const lots = item.lots
      .filter((lot) => isPooledPick(item) || requestedLots.has(lot.id))
      .map((lot) => JSON.stringify([lot.id, lot.lotNo, lot.status, lot.expiryDate, stock.get(lot.id) ?? 0]))
      .sort();
    return [id, item.code, item.barcode, item.unit, item.pickMethod, item.allocationStrategy, lots];
  });
  const lines = transfer.lines.map((line) => JSON.stringify([line.itemId, line.lotId, line.quantity])).sort();
  return createHash('sha256').update(JSON.stringify([
    transfer.id, transfer.sourceLocationId, transfer.destinationLocationId, transfer.assignedPickerId,
    transfer.status, lines, catalog, [...slipIds].sort(),
  ])).digest('hex');
}
