import { randomUUID } from 'node:crypto';
import { prisma, queryRaw, executeRaw } from './db.js';
import { databaseEnabled } from './persistence.js';
import { postInventoryMovementInTransaction } from './inventory-posting-service.js';
import type { TenantContext } from './tenant-context.js';
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

// ADR-004: TransferLine, TransferReceipt and TransferReceiptLine (including
// shortageQty/excessQty) are Prisma models; `prisma migrate deploy` owns
// their schema, so no runtime DDL self-heal is needed here any more.
async function ensureReceiptSchema(): Promise<void> {}

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

// Blueprint v4 §18: "duplicate receive request returns prior result rather
// than double-posting". The database keeps the durable copy (TransferReceipt
// has a unique requestId); this register makes the same true when the API runs
// without a database and answers a retry without a query while the process is up.
const memoryReceipts = new Map<string, StoredReceipt>();
const inFlight = new Set<string>();

export function rememberReceipt(receipt: StoredReceipt): void {
  memoryReceipts.set(receipt.requestId, receipt);
}

/** Claims a requestId for the duration of one request; false while another identical request is running. */
export function beginReceiptRequest(requestId: string): boolean {
  if (inFlight.has(requestId)) return false;
  inFlight.add(requestId);
  return true;
}

export function endReceiptRequest(requestId: string): void {
  inFlight.delete(requestId);
}

export async function findReceiptByRequestId(requestId: string): Promise<StoredReceipt | null> {
  const remembered = memoryReceipts.get(requestId);
  if (remembered) return remembered;
  if (!databaseEnabled) return null;
  await ensureReceiptSchema();
  const rows = await queryRaw<Array<{ id: string; transferId: string; receivedById: string; status: 'RECEIVED' | 'PARTIAL_RECEIVED'; notes: string | null; createdAt: Date }>>(prisma,
    'SELECT id, "transferId", "receivedById", status, notes, "createdAt" FROM "TransferReceipt" WHERE "requestId" = ? LIMIT 1', requestId);
  const row = rows[0];
  if (!row) return null;
  const totals = await queryRaw<Array<{ receivedQty: number; damagedQty: number; shortageQty: number; excessQty: number }>>(prisma,
    'SELECT COALESCE(SUM("receivedQty"),0) "receivedQty", COALESCE(SUM("damagedQty"),0) "damagedQty", COALESCE(SUM("shortageQty"),0) "shortageQty", COALESCE(SUM("excessQty"),0) "excessQty" FROM "TransferReceiptLine" WHERE "receiptId" = ?',
    row.id);
  const total = totals[0] ?? { receivedQty: 0, damagedQty: 0, shortageQty: 0, excessQty: 0 };
  return {
    requestId, transferId: row.transferId, receiptId: row.id, status: row.status, receivedBy: row.receivedById,
    receivedAt: row.createdAt.toISOString(), receivedQty: Number(total.receivedQty), damagedQty: Number(total.damagedQty),
    shortageQty: Number(total.shortageQty), excessQty: Number(total.excessQty), notes: row.notes ?? undefined,
  };
}

export async function persistTransferReceipt(input: {
  requestId: string;
  transferId: string;
  destinationLocationId: string;
  receivedById: string;
  notes: string;
  lines: ReceiptLineInput[];
  tenant: TenantContext;
}): Promise<PersistedReceiptResult | null> {
  if (!databaseEnabled) return null;
  await ensureReceiptSchema();

  return prisma.$transaction(async (tx) => {
    const duplicate = await queryRaw<Array<{ id: string; status: 'RECEIVED' | 'PARTIAL_RECEIVED' }>>(tx,
      'SELECT id, status FROM "TransferReceipt" WHERE "requestId" = ? LIMIT 1', input.requestId);
    if (duplicate[0]) {
      const totals = await queryRaw<Array<{ receivedQty: number; damagedQty: number; shortageQty: number; excessQty: number }>>(tx,
        'SELECT COALESCE(SUM("receivedQty"),0) "receivedQty", COALESCE(SUM("damagedQty"),0) "damagedQty", COALESCE(SUM("shortageQty"),0) "shortageQty", COALESCE(SUM("excessQty"),0) "excessQty" FROM "TransferReceiptLine" WHERE "receiptId" = ?',
        duplicate[0].id);
      const lines = await queryRaw<DbTransferLine[]>(tx,
        'SELECT id,"itemId","lotId","requestedQty","receivedQty","damagedQty","shortageQty","excessQty" FROM "TransferLine" WHERE "transferId" = ? ORDER BY "createdAt",id', input.transferId);
      const total = totals[0] ?? { receivedQty: 0, damagedQty: 0, shortageQty: 0, excessQty: 0 };
      return { duplicate: true, status: duplicate[0].status, receiptId: duplicate[0].id, receivedQty: Number(total.receivedQty), damagedQty: Number(total.damagedQty), shortageQty: Number(total.shortageQty), excessQty: Number(total.excessQty), lines: lines.map((line) => ({ ...line, requestedQty: Number(line.requestedQty), receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty), excessQty: Number(line.excessQty) })) };
    }

    const transfers = await queryRaw<Array<{ status: string }>>(tx,
      'SELECT status FROM "Transfer" WHERE id = ? FOR UPDATE', input.transferId);
    if (!transfers[0]) throw new Error('Transfer was not found.');
    if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'].includes(transfers[0].status)) {
      throw new Error(`Transfer cannot be received while ${transfers[0].status}.`);
    }
    const dbLines = await queryRaw<DbTransferLine[]>(tx,
      'SELECT id,"itemId","lotId","requestedQty","receivedQty","damagedQty","shortageQty","excessQty" FROM "TransferLine" WHERE "transferId" = ? ORDER BY "createdAt",id FOR UPDATE',
      input.transferId);
    const transferLines: TransferReceiptLine[] = dbLines.map((line) => ({
      id: line.id, itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
      receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty),
      excessQty: Number(line.excessQty),
    }));
    const summary = validateReceiptLines(transferLines, input.lines);
    const status = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
    const receiptId = `receipt-${randomUUID()}`;

    await executeRaw(tx,
      'INSERT INTO "TransferReceipt" (id,"requestId","transferId","receivedById",status,notes) VALUES (?,?,?,?,?,?)',
      receiptId, input.requestId, input.transferId, input.receivedById, status, input.notes || null);
    for (const line of input.lines) {
      const dbLine = dbLines.find((candidate) => line.lineId ? candidate.id === line.lineId : candidate.itemId === line.itemId && candidate.lotId === line.lotId)!;
      const excessQty = Number(line.excessQty ?? 0);
      await executeRaw(tx,
        'INSERT INTO "TransferReceiptLine" (id,"receiptId","transferLineId","itemId","lotId","receivedQty","damagedQty","shortageQty","excessQty") VALUES (?,?,?,?,?,?,?,?,?)',
        `receipt-line-${randomUUID()}`, receiptId, dbLine.id, dbLine.itemId, dbLine.lotId, line.receivedQty, line.damagedQty, line.shortageQty, excessQty);
      await executeRaw(tx,
        'UPDATE "TransferLine" SET "receivedQty"="receivedQty"+?, "damagedQty"="damagedQty"+?, "shortageQty"="shortageQty"+?, "excessQty"="excessQty"+?, "updatedAt"=CURRENT_TIMESTAMP(3) WHERE id=?',
        line.receivedQty, line.damagedQty, line.shortageQty, excessQty, dbLine.id);
      // The destination on-hand leg goes through the canonical posting service in
      // this same transaction: journal row + ledger + audit + outbox commit with the
      // receipt. The idempotency key is per receipt line, so a retried request (which
      // the requestId check above already short-circuits) can never post twice.
      if (line.receivedQty > 0) {
        await postInventoryMovementInTransaction(tx as never, {
          tenant: input.tenant,
          itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId,
          movementType: 'TRANSFER_IN', qtyDelta: line.receivedQty,
          idempotencyKey: `transfer-receive:${input.requestId}:${dbLine.id}`,
          reason: 'Transfer receipt', sourceDocument: input.transferId, sourceLineId: dbLine.id, correlationId: receiptId,
        });
      }
      // Release the in-transit quantity the pick-confirm put on the source lot row (audit O-7): received,
      // damaged and short units have all left the "in flight" state. Only transfers whose confirm was
      // marked inTransit release anything, so transfers confirmed before this existed are untouched.
      const settledQty = line.receivedQty + line.damagedQty + line.shortageQty;
      if (settledQty > 0) {
        await executeRaw(tx,
          `UPDATE "StockLedger" SET "inTransit"=GREATEST(0,"inTransit"-?), version=version+1, "lastUpdatedAt"=CURRENT_TIMESTAMP(3)
           WHERE "itemId"=? AND "lotId"=? AND "companyId"=? AND "locationId" IN (
             SELECT "locationId" FROM "StockMovement" WHERE "sourceDocument"=? AND "itemId"=? AND "lotId"=? AND "companyId"=? AND "movementType"='TRANSFER_OUT' AND (metadata->>'inTransit')='true')`,
          settledQty, dbLine.itemId, dbLine.lotId, input.tenant.companyId, input.transferId, dbLine.itemId, dbLine.lotId, input.tenant.companyId);
      }
      // Blueprint section 7.2 / Module H: damaged receiving stock is
      // physically on the shelf but not sellable - post it to the
      // quarantine bucket instead of letting it vanish from the ledger.
      // An Exception Inbox case (created by the caller) tracks disposition;
      // resolving that case is what eventually moves it out of quarantine.
      if (line.damagedQty > 0) {
        await executeRaw(tx,
          `INSERT INTO "StockLedger" (id,"itemId","lotId","locationId","onHand",reserved,"inTransit",quarantine,version,"lastUpdatedAt","tenantId","companyId")
           VALUES (?,?,?,?,0,0,0,?,1,CURRENT_TIMESTAMP(3),?,?)
           ON CONFLICT ("companyId","itemId","lotId","locationId") DO UPDATE SET quarantine="StockLedger".quarantine+EXCLUDED.quarantine,version="StockLedger".version+1,"lastUpdatedAt"=CURRENT_TIMESTAMP(3)`,
          `ledger-${randomUUID()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, line.damagedQty, input.tenant.tenantId, input.tenant.companyId);
      }
      // Excess receipt: never silently absorbed into onHand. It is
      // physically present, so it also lands in quarantine pending an
      // explicit EXCESS_RECEIPT Exception Inbox accept/reject decision -
      // accept posts it to onHand, reject returns it to the vendor/source.
      if (excessQty > 0) {
        await executeRaw(tx,
          `INSERT INTO "StockLedger" (id,"itemId","lotId","locationId","onHand",reserved,"inTransit",quarantine,version,"lastUpdatedAt","tenantId","companyId")
           VALUES (?,?,?,?,0,0,0,?,1,CURRENT_TIMESTAMP(3),?,?)
           ON CONFLICT ("companyId","itemId","lotId","locationId") DO UPDATE SET quarantine="StockLedger".quarantine+EXCLUDED.quarantine,version="StockLedger".version+1,"lastUpdatedAt"=CURRENT_TIMESTAMP(3)`,
          `ledger-${randomUUID()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, excessQty, input.tenant.tenantId, input.tenant.companyId);
      }
    }
    await executeRaw(tx,
      'UPDATE "Transfer" SET status=?, notes=CONCAT(COALESCE(notes,?::text), ?::text), "updatedAt"=CURRENT_TIMESTAMP(3) WHERE id=?',
      status, '', `\n[RECEIPT ${receiptId}] Good: ${summary.receivedQty}, Damaged: ${summary.damagedQty}, Shortage: ${summary.shortageQty}, Excess: ${summary.excessQty}${input.notes ? `, Notes: ${input.notes}` : ''}`, input.transferId);
    const lines = await queryRaw<DbTransferLine[]>(tx,
      'SELECT id,"itemId","lotId","requestedQty","receivedQty","damagedQty","shortageQty","excessQty" FROM "TransferLine" WHERE "transferId" = ? ORDER BY "createdAt",id', input.transferId);
    return { duplicate: false, status, receiptId, ...summary, lines: lines.map((line) => ({ ...line, requestedQty: Number(line.requestedQty), receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty), excessQty: Number(line.excessQty) })) };
  }, { maxWait: 10_000, timeout: 60_000 });
}
