import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { databaseEnabled } from './persistence.js';
import { validateReceiptLines, type ReceiptLineInput, type TransferReceiptLine } from './receipt-validation.js';

type DbTransferLine = {
  id: string; itemId: string; lotId: string; requestedQty: number;
  receivedQty: number; damagedQty: number; shortageQty: number; excessQty: number;
};

export type PersistedReceiptResult = {
  duplicate: boolean;
  status: 'RECEIVED' | 'PARTIAL_RECEIVED';
  receiptId: string;
  receivedQty: number;
  damagedQty: number;
  shortageQty: number;
  excessQty: number;
  lines: DbTransferLine[];
};

export type StoredReceipt = {
  requestId: string;
  transferId: string;
  receiptId?: string;
  status: 'RECEIVED' | 'PARTIAL_RECEIVED';
  receivedBy?: string;
  receivedAt: string;
  receivedQty: number;
  damagedQty: number;
  shortageQty: number;
  excessQty: number;
  notes?: string;
};

const memoryReceipts = new Map<string, StoredReceipt>();
const inFlight = new Set<string>();

export function rememberReceipt(receipt: StoredReceipt): void {
  memoryReceipts.set(receipt.requestId, receipt);
}

export function beginReceiptRequest(requestId: string): boolean {
  if (inFlight.has(requestId)) return false;
  inFlight.add(requestId);
  return true;
}

export function endReceiptRequest(requestId: string): void {
  inFlight.delete(requestId);
}

async function receiptTotals(receiptId: string) {
  const totals = await prisma.transferReceiptLine.aggregate({
    where: { receiptId },
    _sum: { receivedQty: true, damagedQty: true, shortageQty: true, excessQty: true },
  });
  return {
    receivedQty: Number(totals._sum.receivedQty ?? 0),
    damagedQty: Number(totals._sum.damagedQty ?? 0),
    shortageQty: Number(totals._sum.shortageQty ?? 0),
    excessQty: Number(totals._sum.excessQty ?? 0),
  };
}

export async function findReceiptByRequestId(requestId: string): Promise<StoredReceipt | null> {
  const remembered = memoryReceipts.get(requestId);
  if (remembered) return remembered;
  if (!databaseEnabled) return null;
  const row = await prisma.transferReceipt.findUnique({ where: { requestId } });
  if (!row) return null;
  const totals = await receiptTotals(row.id);
  return {
    requestId,
    transferId: row.transferId,
    receiptId: row.id,
    status: row.status as StoredReceipt['status'],
    receivedBy: row.receivedById,
    receivedAt: row.createdAt.toISOString(),
    ...totals,
    notes: row.notes ?? undefined,
  };
}

export async function persistTransferReceipt(input: {
  requestId: string;
  transferId: string;
  destinationLocationId: string;
  receivedById: string;
  notes: string;
  lines: ReceiptLineInput[];
}): Promise<PersistedReceiptResult | null> {
  if (!databaseEnabled) return null;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Transfer" WHERE "id" = $1 FOR UPDATE',
      input.transferId,
    );
    if (!locked[0]) throw new Error('Transfer was not found.');

    const duplicate = await tx.transferReceipt.findUnique({ where: { requestId: input.requestId } });
    if (duplicate) {
      const totals = await tx.transferReceiptLine.aggregate({
        where: { receiptId: duplicate.id },
        _sum: { receivedQty: true, damagedQty: true, shortageQty: true, excessQty: true },
      });
      const lines = await tx.transferLine.findMany({
        where: { transferId: input.transferId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, itemId: true, lotId: true, requestedQty: true, receivedQty: true, damagedQty: true, shortageQty: true, excessQty: true },
      });
      return {
        duplicate: true,
        status: duplicate.status as PersistedReceiptResult['status'],
        receiptId: duplicate.id,
        receivedQty: Number(totals._sum.receivedQty ?? 0),
        damagedQty: Number(totals._sum.damagedQty ?? 0),
        shortageQty: Number(totals._sum.shortageQty ?? 0),
        excessQty: Number(totals._sum.excessQty ?? 0),
        lines,
      };
    }

    const transfer = await tx.transfer.findUnique({ where: { id: input.transferId }, select: { status: true, notes: true } });
    if (!transfer) throw new Error('Transfer was not found.');
    if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'].includes(transfer.status)) {
      throw new Error(`Transfer cannot be received while ${transfer.status}.`);
    }
    const dbLines = await tx.transferLine.findMany({
      where: { transferId: input.transferId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, itemId: true, lotId: true, requestedQty: true, receivedQty: true, damagedQty: true, shortageQty: true, excessQty: true },
    });
    const transferLines: TransferReceiptLine[] = dbLines.map((line) => ({
      id: line.id, itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
      receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty),
      shortageQty: Number(line.shortageQty), excessQty: Number(line.excessQty),
    }));
    const summary = validateReceiptLines(transferLines, input.lines);
    const status: PersistedReceiptResult['status'] = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
    const receiptId = `receipt-${randomUUID()}`;

    await tx.transferReceipt.create({
      data: { id: receiptId, requestId: input.requestId, transferId: input.transferId, receivedById: input.receivedById, status, notes: input.notes || null },
    });
    for (const line of input.lines) {
      const dbLine = dbLines.find((candidate) => line.lineId ? candidate.id === line.lineId : candidate.itemId === line.itemId && candidate.lotId === line.lotId)!;
      const excessQty = Number(line.excessQty ?? 0);
      await tx.transferReceiptLine.create({
        data: {
          id: `receipt-line-${randomUUID()}`, receiptId, transferLineId: dbLine.id,
          itemId: dbLine.itemId, lotId: dbLine.lotId, receivedQty: line.receivedQty,
          damagedQty: line.damagedQty, shortageQty: line.shortageQty, excessQty,
        },
      });
      await tx.transferLine.update({
        where: { id: dbLine.id },
        data: {
          receivedQty: { increment: line.receivedQty },
          damagedQty: { increment: line.damagedQty },
          shortageQty: { increment: line.shortageQty },
          excessQty: { increment: excessQty },
        },
      });
      if (line.receivedQty > 0) {
        await tx.stockLedger.upsert({
          where: { itemId_lotId_locationId: { itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId } },
          create: { id: `ledger-${randomUUID()}`, itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId, onHand: line.receivedQty, version: 1 },
          update: { onHand: { increment: line.receivedQty }, version: { increment: 1 } },
        });
      }
      const quarantineQty = line.damagedQty + excessQty;
      if (quarantineQty > 0) {
        await tx.stockLedger.upsert({
          where: { itemId_lotId_locationId: { itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId } },
          create: { id: `ledger-${randomUUID()}`, itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId, quarantine: quarantineQty, version: 1 },
          update: { quarantine: { increment: quarantineQty }, version: { increment: 1 } },
        });
      }
    }
    const receiptNote = `[RECEIPT ${receiptId}] Good: ${summary.receivedQty}, Damaged: ${summary.damagedQty}, Shortage: ${summary.shortageQty}, Excess: ${summary.excessQty}${input.notes ? `, Notes: ${input.notes}` : ''}`;
    await tx.transfer.update({
      where: { id: input.transferId },
      data: { status, notes: [transfer.notes, receiptNote].filter(Boolean).join('\n') },
    });
    const lines = await tx.transferLine.findMany({
      where: { transferId: input.transferId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, itemId: true, lotId: true, requestedQty: true, receivedQty: true, damagedQty: true, shortageQty: true, excessQty: true },
    });
    return { duplicate: false, status, receiptId, ...summary, lines };
  }, { maxWait: 10_000, timeout: 60_000 });
}
