"use strict";
// Blueprint P8: true bin-level inventory. Location ATP (StockLedger keyed
// by item+lot+location) stays the reservation pool; this projection answers
// "how much live stock is in Bin A" and is updated on putaway confirm and
// scan-confirmed picks.
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryBinStock = exports.STAGING_BIN_ID = exports.BinStockLedger = void 0;
exports.listMemoryBins = listMemoryBins;
exports.findMemoryBin = findMemoryBin;
exports.createMemoryBin = createMemoryBin;
exports.moveBinStockPersisted = moveBinStockPersisted;
exports.persistBinStockDelta = persistBinStockDelta;
function keyOf(key) {
    return `${key.itemId}::${key.lotId ?? 'NOLOT'}::${key.locationId}::${key.binId}`;
}
class BinStockLedger {
    rows = new Map();
    get(key) {
        const existing = this.rows.get(keyOf(key));
        if (existing)
            return { ...existing };
        return { ...key, onHand: 0, reserved: 0, version: 0 };
    }
    list(filter = {}) {
        return [...this.rows.values()]
            .filter((row) => {
            if (filter.itemId && row.itemId !== filter.itemId)
                return false;
            if (filter.locationId && row.locationId !== filter.locationId)
                return false;
            if (filter.binId && row.binId !== filter.binId)
                return false;
            if (filter.lotId !== undefined && row.lotId !== filter.lotId)
                return false;
            return true;
        })
            .map((row) => ({ ...row }));
    }
    onHandInBin(locationId, binId, itemId) {
        return this.list({ locationId, binId, itemId }).reduce((sum, row) => sum + row.onHand, 0);
    }
    apply(key, qtyDelta) {
        const current = this.get(key);
        const onHand = current.onHand + qtyDelta;
        if (onHand < -1e-8) {
            throw new Error(`Bin ${key.binId} does not have ${-qtyDelta} of item ${key.itemId}.`);
        }
        const next = { ...current, onHand, version: current.version + 1 };
        this.rows.set(keyOf(key), next);
        return { ...next };
    }
    move(from, toBinId, quantity) {
        const fromRow = this.apply(from, -quantity);
        const toRow = this.apply({ ...from, binId: toBinId }, quantity);
        return { from: fromRow, to: toRow };
    }
}
exports.BinStockLedger = BinStockLedger;
exports.STAGING_BIN_ID = '__STAGING__';
exports.memoryBinStock = new BinStockLedger();
const memoryBins = [];
function listMemoryBins(locationId) {
    return memoryBins.filter((bin) => bin.locationId === locationId).map((bin) => ({ ...bin }));
}
function findMemoryBin(id) {
    const bin = memoryBins.find((row) => row.id === id);
    return bin ? { ...bin } : undefined;
}
function createMemoryBin(input) {
    const bin = {
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
const memoryBinMovements = [];
/**
 * Moves stock from one bin to another and records the move in the
 * BinMovement ledger, transactionally. The caller must have already
 * validated the scans (assertValidBinMove) - this only persists.
 */
async function moveBinStockPersisted(input) {
    const { prisma } = await import('./db.js');
    const { databaseEnabled } = await import('./persistence.js');
    const lotId = input.lotId ?? '';
    if (!databaseEnabled) {
        exports.memoryBinStock.move(input, input.toBinId, input.quantity);
        const record = {
            itemId: input.itemId, lotId, locationId: input.locationId, binId: input.binId,
            toBinId: input.toBinId, quantity: input.quantity,
            reference: input.reference ?? null, actorId: input.actorId ?? null,
            createdAt: new Date().toISOString(),
        };
        memoryBinMovements.push(record);
        return { id: `mem-${memoryBinMovements.length}`, itemId: input.itemId, lotId, locationId: input.locationId, fromBinId: input.binId, toBinId: input.toBinId, quantity: input.quantity, reference: record.reference, actorId: record.actorId, createdAt: record.createdAt };
    }
    const [, , movement] = await prisma.$transaction(async (tx) => {
        const fromKey = { itemId_lotId_locationId_binId: { itemId: input.itemId, lotId, locationId: input.locationId, binId: input.binId } };
        const fromRow = await tx.binStock.findUnique({ where: fromKey });
        const fromOnHand = (fromRow?.onHand ?? 0) - input.quantity;
        if (fromOnHand < -1e-8)
            throw new Error(`Bin ${input.binId} does not have ${input.quantity} of item ${input.itemId}.`);
        const fromUpdate = fromRow
            ? tx.binStock.update({ where: { id: fromRow.id }, data: { onHand: fromOnHand, version: { increment: 1 } } })
            : tx.binStock.create({ data: { itemId: input.itemId, lotId, locationId: input.locationId, binId: input.binId, onHand: fromOnHand } });
        const toKey = { itemId_lotId_locationId_binId: { itemId: input.itemId, lotId, locationId: input.locationId, binId: input.toBinId } };
        const toRow = await tx.binStock.findUnique({ where: toKey });
        const toUpdate = toRow
            ? tx.binStock.update({ where: { id: toRow.id }, data: { onHand: toRow.onHand + input.quantity, version: { increment: 1 } } })
            : tx.binStock.create({ data: { itemId: input.itemId, lotId, locationId: input.locationId, binId: input.toBinId, onHand: input.quantity } });
        const movementCreate = tx.binMovement.create({
            data: {
                itemId: input.itemId, lotId, locationId: input.locationId,
                fromBinId: input.binId, toBinId: input.toBinId, quantity: input.quantity,
                reference: input.reference ?? null, actorId: input.actorId ?? null,
            },
        });
        return Promise.all([fromUpdate, toUpdate, movementCreate]);
    });
    return movement;
}
async function persistBinStockDelta(input) {
    const { prisma } = await import('./db.js');
    const { databaseEnabled } = await import('./persistence.js');
    if (!databaseEnabled) {
        exports.memoryBinStock.apply(input, input.qtyDelta);
        return;
    }
    const lotId = input.lotId ?? '';
    const existing = await prisma.binStock.findUnique({
        where: { itemId_lotId_locationId_binId: { itemId: input.itemId, lotId, locationId: input.locationId, binId: input.binId } },
    }).catch(() => null);
    if (!existing) {
        if (input.qtyDelta < -1e-8)
            throw new Error(`Bin ${input.binId} does not have ${-input.qtyDelta} of item ${input.itemId}.`);
        await prisma.binStock.create({
            data: { itemId: input.itemId, lotId, locationId: input.locationId, binId: input.binId, onHand: input.qtyDelta },
        });
        return;
    }
    const onHand = existing.onHand + input.qtyDelta;
    if (onHand < -1e-8)
        throw new Error(`Bin ${input.binId} does not have ${-input.qtyDelta} of item ${input.itemId}.`);
    await prisma.binStock.update({ where: { id: existing.id }, data: { onHand, version: { increment: 1 } } });
}
