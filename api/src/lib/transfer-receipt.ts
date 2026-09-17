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

let schemaReady = false;
async function ensureReceiptSchema(): Promise<void> {
  if (schemaReady) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE TransferLine ADD COLUMN IF NOT EXISTS shortageQty DOUBLE NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`ALTER TABLE TransferLine ADD COLUMN IF NOT EXISTS excessQty DOUBLE NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS TransferReceipt (
    id VARCHAR(191) PRIMARY KEY,
    requestId VARCHAR(191) NOT NULL UNIQUE,
    transferId VARCHAR(191) NOT NULL,
    receivedById VARCHAR(191) NOT NULL,
    status VARCHAR(40) NOT NULL,
    notes TEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX TransferReceipt_transferId_createdAt_idx (transferId, createdAt)
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS TransferReceiptLine (
    id VARCHAR(191) PRIMARY KEY,
    receiptId VARCHAR(191) NOT NULL,
    transferLineId VARCHAR(191) NOT NULL,
    itemId VARCHAR(191) NOT NULL,
    lotId VARCHAR(191) NOT NULL,
    receivedQty DOUBLE NOT NULL DEFAULT 0,
    damagedQty DOUBLE NOT NULL DEFAULT 0,
    shortageQty DOUBLE NOT NULL DEFAULT 0,
    excessQty DOUBLE NOT NULL DEFAULT 0,
    INDEX TransferReceiptLine_transferLineId_idx (transferLineId),
    INDEX TransferReceiptLine_receiptId_idx (receiptId)
  )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE TransferReceiptLine ADD COLUMN IF NOT EXISTS excessQty DOUBLE NOT NULL DEFAULT 0`);
  schemaReady = true;
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
  await ensureReceiptSchema();

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.$queryRawUnsafe<Array<{ id: string; status: 'RECEIVED' | 'PARTIAL_RECEIVED' }>>(
      'SELECT id, status FROM TransferReceipt WHERE requestId = ? LIMIT 1', input.requestId);
    if (duplicate[0]) {
      const totals = await tx.$queryRawUnsafe<Array<{ receivedQty: number; damagedQty: number; shortageQty: number; excessQty: number }>>(
        'SELECT COALESCE(SUM(receivedQty),0) receivedQty, COALESCE(SUM(damagedQty),0) damagedQty, COALESCE(SUM(shortageQty),0) shortageQty, COALESCE(SUM(excessQty),0) excessQty FROM TransferReceiptLine WHERE receiptId = ?',
        duplicate[0].id);
      const lines = await tx.$queryRawUnsafe<DbTransferLine[]>(
        'SELECT id,itemId,lotId,requestedQty,receivedQty,damagedQty,shortageQty,excessQty FROM TransferLine WHERE transferId = ? ORDER BY createdAt,id', input.transferId);
      return { duplicate: true, status: duplicate[0].status, receiptId: duplicate[0].id, ...totals[0], lines };
    }

    const transfers = await tx.$queryRawUnsafe<Array<{ status: string }>>(
      'SELECT status FROM Transfer WHERE id = ? FOR UPDATE', input.transferId);
    if (!transfers[0]) throw new Error('Transfer was not found.');
    if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'].includes(transfers[0].status)) {
      throw new Error(`Transfer cannot be received while ${transfers[0].status}.`);
    }
    const dbLines = await tx.$queryRawUnsafe<DbTransferLine[]>(
      'SELECT id,itemId,lotId,requestedQty,receivedQty,damagedQty,shortageQty,excessQty FROM TransferLine WHERE transferId = ? ORDER BY createdAt,id FOR UPDATE',
      input.transferId);
    const transferLines: TransferReceiptLine[] = dbLines.map((line) => ({
      id: line.id, itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
      receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty),
      excessQty: Number(line.excessQty),
    }));
    const summary = validateReceiptLines(transferLines, input.lines);
    const status = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
    const receiptId = `receipt-${randomUUID()}`;

    await tx.$executeRawUnsafe(
      'INSERT INTO TransferReceipt (id,requestId,transferId,receivedById,status,notes) VALUES (?,?,?,?,?,?)',
      receiptId, input.requestId, input.transferId, input.receivedById, status, input.notes || null);
    for (const line of input.lines) {
      const dbLine = dbLines.find((candidate) => line.lineId ? candidate.id === line.lineId : candidate.itemId === line.itemId && candidate.lotId === line.lotId)!;
      const excessQty = Number(line.excessQty ?? 0);
      await tx.$executeRawUnsafe(
        'INSERT INTO TransferReceiptLine (id,receiptId,transferLineId,itemId,lotId,receivedQty,damagedQty,shortageQty,excessQty) VALUES (?,?,?,?,?,?,?,?,?)',
        `receipt-line-${randomUUID()}`, receiptId, dbLine.id, dbLine.itemId, dbLine.lotId, line.receivedQty, line.damagedQty, line.shortageQty, excessQty);
      await tx.$executeRawUnsafe(
        'UPDATE TransferLine SET receivedQty=receivedQty+?, damagedQty=damagedQty+?, shortageQty=shortageQty+?, excessQty=excessQty+?, updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?',
        line.receivedQty, line.damagedQty, line.shortageQty, excessQty, dbLine.id);
      if (line.receivedQty > 0) {
        await tx.$executeRawUnsafe(
          `INSERT INTO StockLedger (id,itemId,lotId,locationId,onHand,reserved,inTransit,version,lastUpdatedAt)
           VALUES (?,?,?,?,?,0,0,1,CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE onHand=onHand+VALUES(onHand),version=version+1,lastUpdatedAt=CURRENT_TIMESTAMP(3)`,
          `ledger-${randomUUID()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, line.receivedQty);
      }
      // Blueprint section 7.2 / Module H: damaged receiving stock is
      // physically on the shelf but not sellable - post it to the
      // quarantine bucket instead of letting it vanish from the ledger.
      // An Exception Inbox case (created by the caller) tracks disposition;
      // resolving that case is what eventually moves it out of quarantine.
      if (line.damagedQty > 0) {
        await tx.$executeRawUnsafe(
          `INSERT INTO StockLedger (id,itemId,lotId,locationId,onHand,reserved,inTransit,quarantine,version,lastUpdatedAt)
           VALUES (?,?,?,?,0,0,0,?,1,CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE quarantine=quarantine+VALUES(quarantine),version=version+1,lastUpdatedAt=CURRENT_TIMESTAMP(3)`,
          `ledger-${randomUUID()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, line.damagedQty);
      }
      // Excess receipt: never silently absorbed into onHand. It is
      // physically present, so it also lands in quarantine pending an
      // explicit EXCESS_RECEIPT Exception Inbox accept/reject decision -
      // accept posts it to onHand, reject returns it to the vendor/source.
      if (excessQty > 0) {
        await tx.$executeRawUnsafe(
          `INSERT INTO StockLedger (id,itemId,lotId,locationId,onHand,reserved,inTransit,quarantine,version,lastUpdatedAt)
           VALUES (?,?,?,?,0,0,0,?,1,CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE quarantine=quarantine+VALUES(quarantine),version=version+1,lastUpdatedAt=CURRENT_TIMESTAMP(3)`,
          `ledger-${randomUUID()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, excessQty);
      }
    }
    await tx.$executeRawUnsafe(
      'UPDATE Transfer SET status=?, notes=CONCAT(COALESCE(notes,? ), ?), updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?',
      status, '', `\n[RECEIPT ${receiptId}] Good: ${summary.receivedQty}, Damaged: ${summary.damagedQty}, Shortage: ${summary.shortageQty}, Excess: ${summary.excessQty}${input.notes ? `, Notes: ${input.notes}` : ''}`, input.transferId);
    const lines = await tx.$queryRawUnsafe<DbTransferLine[]>(
      'SELECT id,itemId,lotId,requestedQty,receivedQty,damagedQty,shortageQty,excessQty FROM TransferLine WHERE transferId = ? ORDER BY createdAt,id', input.transferId);
    return { duplicate: false, status, receiptId, ...summary, lines };
  }, { maxWait: 10_000, timeout: 60_000 });
}
