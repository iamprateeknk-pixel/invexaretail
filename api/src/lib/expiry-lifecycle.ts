import { createHash } from 'node:crypto';

import { daysUntilExpiry, expirySeverity, recommendedExpiryAction } from './expiry-alerts.js';
import { buildExpiryBoard, type ExpiryBoard } from './expiry-board.js';
import {
  adjustStockLedger,
  findStockLedgerEntry,
  listItems,
  listStockLedgerForLocation,
  stockMovements,
  updateLotExpiry,
  updateLotStatus,
  type LotRecord,
  type Role,
} from './repository.js';
import type { StockMovementRecord } from './stock-ledger.js';

export class ExpiryWriteOffError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'ExpiryWriteOffError';
  }
}

export function expiryAlertId(itemId: string, lotId: string, locationId: string): string {
  return `expiry-${createHash('sha1').update(`${itemId}|${lotId}|${locationId}`).digest('hex').slice(0, 24)}`;
}

export function assertCanWriteOffExpiry(role: Role | string): void {
  if (role !== 'ADMIN') {
    throw new ExpiryWriteOffError('Only the Main Admin can post an expiry write-off.', 403);
  }
}

export function parseWriteOffReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 5) {
    throw new ExpiryWriteOffError('A write-off reason of at least 5 characters is required.', 400);
  }
  return reason;
}

export function buildLocationExpiryBoard(locationId: string, now = new Date()): ExpiryBoard {
  const items = listItems();
  const stock = listStockLedgerForLocation(locationId);
  return buildExpiryBoard({
    items,
    lots: items.flatMap((item) => item.lots),
    stock: stock.map((row) => ({
      itemId: row.itemId,
      lotId: row.lotId,
      locationId: row.locationId,
      quantity: row.onHand,
    })),
    now,
  });
}

export function listLocationExpiryAlerts(locationId: string, now = new Date()) {
  const items = listItems();
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return listStockLedgerForLocation(locationId)
    .filter((row) => row.onHand > 0)
    .map((row) => {
      const item = itemMap.get(row.itemId);
      const lot = item?.lots.find((entry) => entry.id === row.lotId);
      if (!item || !lot?.expiryDate) return null;
      const expiry = new Date(lot.expiryDate);
      if (Number.isNaN(expiry.getTime())) return null;
      const days = daysUntilExpiry(expiry, now);
      return {
        id: expiryAlertId(row.itemId, row.lotId, row.locationId),
        itemId: row.itemId,
        lotId: row.lotId,
        locationId: row.locationId,
        quantity: row.onHand,
        expiryDate: lot.expiryDate,
        daysUntilExpiry: days,
        status: 'ACTIVE',
        recommendedAction: recommendedExpiryAction(days),
        item: { code: item.code, name: item.name },
        lot: { lotNo: lot.lotNo, status: lot.status ?? 'AVAILABLE' },
        severity: expirySeverity(days),
      };
    })
    .filter((alert): alert is NonNullable<typeof alert> => Boolean(alert))
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

export function writeOffExpiryLot(input: {
  itemId: string;
  lotId: string;
  locationId: string;
  quantity?: number;
  reason: string;
  actorId: string;
  role: Role | string;
}): { alertId: string; movementId: string; quantity: number; beforeBalance: number; afterBalance: number } {
  assertCanWriteOffExpiry(input.role);
  const reason = parseWriteOffReason(input.reason);
  const item = listItems().find((entry) => entry.id === input.itemId);
  const lot = item?.lots.find((entry) => entry.id === input.lotId);
  if (!item || !lot) throw new ExpiryWriteOffError('Lot not found.', 404);
  const ledger = findStockLedgerEntry(input.itemId, input.lotId, input.locationId);
  const requested = Number(input.quantity);
  const quantity = Number.isFinite(requested) && requested > 0 ? requested : Number(ledger?.onHand ?? 0);
  if (!ledger || quantity <= 0 || quantity > ledger.onHand) {
    throw new ExpiryWriteOffError('Write-off quantity exceeds current lot stock.', 400);
  }

  const alertId = expiryAlertId(input.itemId, input.lotId, input.locationId);

  const beforeBalance = ledger.onHand;
  const after = adjustStockLedger(input.itemId, input.lotId, input.locationId, -quantity);
  const movement: StockMovementRecord = {
    id: `mv-exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: input.itemId,
    lotId: input.lotId,
    locationId: input.locationId,
    movementType: 'EXPIRY_WRITE_OFF',
    qtyDelta: -quantity,
    beforeBalance,
    afterBalance: after.onHand,
    sourceDocument: alertId,
    actor: input.actorId,
    timestamp: new Date().toISOString(),
    correlationId: alertId,
    reason,
    metadata: { expiryDate: lot.expiryDate ?? null, alertId },
  };
  stockMovements.push(movement);
  if ((lot.status ?? 'AVAILABLE') === 'AVAILABLE' && lot.expiryDate && daysUntilExpiry(new Date(lot.expiryDate)) < 0) {
    try {
      updateLotStatus(lot.id, 'EXPIRED');
    } catch {
      // Status is advisory; stock has already been written off.
    }
  }
  return { alertId, movementId: movement.id, quantity, beforeBalance, afterBalance: after.onHand };
}

export function setLotExpiryDate(lotId: string, raw: unknown): LotRecord {
  let expiryDate: string | null = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    const parsed = new Date(String(raw));
    if (Number.isNaN(parsed.getTime())) throw new ExpiryWriteOffError('Expiry date is invalid.', 400);
    expiryDate = parsed.toISOString();
  }
  return updateLotExpiry(lotId, expiryDate);
}

export function setLotSaleStatus(lotId: string, status: unknown): LotRecord {
  const valid = ['AVAILABLE', 'EXPIRED', 'BLOCKED', 'QUARANTINE'] as const;
  if (!valid.includes(status as (typeof valid)[number])) {
    throw new ExpiryWriteOffError('Invalid lot status.', 400);
  }
  return updateLotStatus(lotId, status as (typeof valid)[number]);
}
