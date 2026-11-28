// Blueprint P8: true bin-level inventory. Location ATP (StockLedger keyed
// by item+lot+location) stays the reservation pool; this projection answers
// "how much live stock is in Bin A" and is updated on putaway confirm and
// scan-confirmed picks.

import type { Prisma } from '@prisma/client';

export type BinStockKey = { itemId: string; lotId: string | null; locationId: string; binId: string };

export type BinStockRecord = BinStockKey & { onHand: number; reserved: number; version: number };

function keyOf(key: BinStockKey): string {
  return `${key.itemId}::${key.lotId ?? 'NOLOT'}::${key.locationId}::${key.binId}`;
}

export class BinStockLedger {
  private readonly rows = new Map<string, BinStockRecord>();

  get(key: BinStockKey): BinStockRecord {
    const existing = this.rows.get(keyOf(key));
    if (existing) return { ...existing };
    return { ...key, onHand: 0, reserved: 0, version: 0 };
  }

  list(filter: Partial<BinStockKey> = {}): BinStockRecord[] {
    return [...this.rows.values()]
      .filter((row) => {
        if (filter.itemId && row.itemId !== filter.itemId) return false;
        if (filter.locationId && row.locationId !== filter.locationId) return false;
        if (filter.binId && row.binId !== filter.binId) return false;
        if (filter.lotId !== undefined && row.lotId !== filter.lotId) return false;
        return true;
      })
      .map((row) => ({ ...row }));
  }

  onHandInBin(locationId: string, binId: string, itemId?: string): number {
    return this.list({ locationId, binId, itemId }).reduce((sum, row) => sum + row.onHand, 0);
  }

  apply(key: BinStockKey, qtyDelta: number): BinStockRecord {
    const current = this.get(key);
    const onHand = current.onHand + qtyDelta;
    if (onHand < -1e-8) {
      throw new Error(`Bin ${key.binId} does not have ${-qtyDelta} of item ${key.itemId}.`);
    }
    const next: BinStockRecord = { ...current, onHand, version: current.version + 1 };
    this.rows.set(keyOf(key), next);
    return { ...next };
  }

  move(from: BinStockKey, toBinId: string, quantity: number): { from: BinStockRecord; to: BinStockRecord } {
    const fromRow = this.apply(from, -quantity);
    const toRow = this.apply({ ...from, binId: toBinId }, quantity);
    return { from: fromRow, to: toRow };
  }
}

export const STAGING_BIN_ID = '__STAGING__';
export const memoryBinStock = new BinStockLedger();

export type MemoryBin = {
  id: string;
  locationId: string;
  code: string;
  zone: string | null;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  capacity: number | null;
  storageClass: string | null;
};

const memoryBins: MemoryBin[] = [];

export function listMemoryBins(locationId: string): MemoryBin[] {
  return memoryBins.filter((bin) => bin.locationId === locationId).map((bin) => ({ ...bin }));
}

export function findMemoryBin(id: string): MemoryBin | undefined {
  const bin = memoryBins.find((row) => row.id === id);
  return bin ? { ...bin } : undefined;
}

export function createMemoryBin(input: Omit<MemoryBin, 'id'> & { id?: string }): MemoryBin {
  const bin: MemoryBin = {
    id: input.id ?? `bin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    locationId: input.locationId,
    code: input.code,
    zone: input.zone,
    aisle: input.aisle,
    rack: input.rack,
    shelf: input.shelf,
    capacity: input.capacity,
    storageClass: input.storageClass,
  };
  memoryBins.push(bin);
  return { ...bin };
}

const memoryBinMovements: Array<BinStockKey & { toBinId: string; quantity: number; reference: string | null; actorId: string | null; createdAt: string }> = [];

export type BinMoveRecord = {
  id: string;
  itemId: string;
  lotId: string;
  locationId: string;
  fromBinId: string;
  toBinId: string;
  quantity: number;
  reference: string | null;
  actorId: string | null;
  createdAt: Date | string;
};

/**
 * Moves stock from one bin to another and records the move in the
 * BinMovement ledger, transactionally. The caller must have already
 * validated the scans (assertValidBinMove) - this only persists.
 */
type BinMoveInput = BinStockKey & { companyId: string; toBinId: string; quantity: number; reference?: string | null; actorId?: string | null };

export async function moveBinStockPersisted(input: BinMoveInput): Promise<BinMoveRecord> {
  const { prisma } = await import('./db.js');
  const { databaseEnabled } = await import('./persistence.js');
  const lotId = input.lotId ?? '';
  if (!databaseEnabled) {
    memoryBinStock.move(input, input.toBinId, input.quantity);
    const record = {
      itemId: input.itemId, lotId, locationId: input.locationId, binId: input.binId,
      toBinId: input.toBinId, quantity: input.quantity,
      reference: input.reference ?? null, actorId: input.actorId ?? null,
      createdAt: new Date().toISOString(),
    };
    memoryBinMovements.push(record);
    return { id: `mem-${memoryBinMovements.length}`, itemId: input.itemId, lotId, locationId: input.locationId, fromBinId: input.binId, toBinId: input.toBinId, quantity: input.quantity, reference: record.reference, actorId: record.actorId, createdAt: record.createdAt };
  }
  return prisma.$transaction((tx) => moveBinStockInTransaction(tx, input));
}

export async function moveBinStockInTransaction(tx: Prisma.TransactionClient, input: BinMoveInput): Promise<BinMoveRecord> {
  await applyBinStockDelta(tx, { ...input, qtyDelta: -input.quantity });
  await applyBinStockDelta(tx, { ...input, binId: input.toBinId, qtyDelta: input.quantity });
  const movement = await tx.binMovement.create({
    data: {
      companyId: input.companyId, itemId: input.itemId, lotId: input.lotId ?? '', locationId: input.locationId,
      fromBinId: input.binId, toBinId: input.toBinId, quantity: input.quantity,
      reference: input.reference ?? null, actorId: input.actorId ?? null,
    },
  });
  return { ...movement, quantity: Number(movement.quantity) };
}

export class BinStockShortageError extends Error {}

async function applyBinStockDelta(tx: Prisma.TransactionClient, input: BinStockKey & { companyId: string; qtyDelta: number }): Promise<void> {
  const { companyId, itemId, locationId, binId, qtyDelta } = input;
  const key = { companyId, itemId, lotId: input.lotId ?? '', locationId, binId };
  const update = { onHand: { increment: qtyDelta }, version: { increment: 1 } };
  if (qtyDelta < 0) {
    const changed = await tx.binStock.updateMany({ where: { ...key, onHand: { gte: -qtyDelta } }, data: update });
    if (changed.count !== 1) throw new BinStockShortageError(`Bin ${binId} does not have ${-qtyDelta} of item ${itemId}.`);
    return;
  }
  await tx.binStock.upsert({
    where: { companyId_itemId_lotId_locationId_binId: key },
    create: { ...key, onHand: qtyDelta },
    update,
  });
}

export async function persistBinStockDelta(input: BinStockKey & { companyId: string; qtyDelta: number }): Promise<void> {
  const { prisma } = await import('./db.js');
  const { databaseEnabled } = await import('./persistence.js');
  if (!databaseEnabled) {
    memoryBinStock.apply(input, input.qtyDelta);
    return;
  }
  await applyBinStockDelta(prisma, input);
}
