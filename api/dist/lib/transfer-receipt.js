"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rememberReceipt = rememberReceipt;
exports.beginReceiptRequest = beginReceiptRequest;
exports.endReceiptRequest = endReceiptRequest;
exports.findReceiptByRequestId = findReceiptByRequestId;
exports.persistTransferReceipt = persistTransferReceipt;
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
const receipt_validation_js_1 = require("./receipt-validation.js");
let schemaReady = false;
async function ensureReceiptSchema() {
    if (schemaReady)
        return;
    await db_js_1.prisma.$executeRawUnsafe(`ALTER TABLE TransferLine ADD COLUMN IF NOT EXISTS shortageQty DOUBLE NOT NULL DEFAULT 0`);
    await db_js_1.prisma.$executeRawUnsafe(`ALTER TABLE TransferLine ADD COLUMN IF NOT EXISTS excessQty DOUBLE NOT NULL DEFAULT 0`);
    await db_js_1.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS TransferReceipt (
    id VARCHAR(191) PRIMARY KEY,
    requestId VARCHAR(191) NOT NULL UNIQUE,
    transferId VARCHAR(191) NOT NULL,
    receivedById VARCHAR(191) NOT NULL,
    status VARCHAR(40) NOT NULL,
    notes TEXT NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX TransferReceipt_transferId_createdAt_idx (transferId, createdAt)
  )`);
    await db_js_1.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS TransferReceiptLine (
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
    await db_js_1.prisma.$executeRawUnsafe(`ALTER TABLE TransferReceiptLine ADD COLUMN IF NOT EXISTS excessQty DOUBLE NOT NULL DEFAULT 0`);
    schemaReady = true;
}
// Blueprint v4 §18: "duplicate receive request returns prior result rather
// than double-posting". The database keeps the durable copy (TransferReceipt
// has a unique requestId); this register makes the same true when the API runs
// without a database and answers a retry without a query while the process is up.
const memoryReceipts = new Map();
const inFlight = new Set();
function rememberReceipt(receipt) {
    memoryReceipts.set(receipt.requestId, receipt);
}
/** Claims a requestId for the duration of one request; false while another identical request is running. */
function beginReceiptRequest(requestId) {
    if (inFlight.has(requestId))
        return false;
    inFlight.add(requestId);
    return true;
}
function endReceiptRequest(requestId) {
    inFlight.delete(requestId);
}
async function findReceiptByRequestId(requestId) {
    const remembered = memoryReceipts.get(requestId);
    if (remembered)
        return remembered;
    if (!persistence_js_1.databaseEnabled)
        return null;
    await ensureReceiptSchema();
    const rows = await db_js_1.prisma.$queryRawUnsafe('SELECT id, transferId, receivedById, status, notes, createdAt FROM TransferReceipt WHERE requestId = ? LIMIT 1', requestId);
    const row = rows[0];
    if (!row)
        return null;
    const totals = await db_js_1.prisma.$queryRawUnsafe('SELECT COALESCE(SUM(receivedQty),0) receivedQty, COALESCE(SUM(damagedQty),0) damagedQty, COALESCE(SUM(shortageQty),0) shortageQty, COALESCE(SUM(excessQty),0) excessQty FROM TransferReceiptLine WHERE receiptId = ?', row.id);
    const total = totals[0] ?? { receivedQty: 0, damagedQty: 0, shortageQty: 0, excessQty: 0 };
    return {
        requestId, transferId: row.transferId, receiptId: row.id, status: row.status, receivedBy: row.receivedById,
        receivedAt: row.createdAt.toISOString(), receivedQty: Number(total.receivedQty), damagedQty: Number(total.damagedQty),
        shortageQty: Number(total.shortageQty), excessQty: Number(total.excessQty), notes: row.notes ?? undefined,
    };
}
async function persistTransferReceipt(input) {
    if (!persistence_js_1.databaseEnabled)
        return null;
    await ensureReceiptSchema();
    return db_js_1.prisma.$transaction(async (tx) => {
        const duplicate = await tx.$queryRawUnsafe('SELECT id, status FROM TransferReceipt WHERE requestId = ? LIMIT 1', input.requestId);
        if (duplicate[0]) {
            const totals = await tx.$queryRawUnsafe('SELECT COALESCE(SUM(receivedQty),0) receivedQty, COALESCE(SUM(damagedQty),0) damagedQty, COALESCE(SUM(shortageQty),0) shortageQty, COALESCE(SUM(excessQty),0) excessQty FROM TransferReceiptLine WHERE receiptId = ?', duplicate[0].id);
            const lines = await tx.$queryRawUnsafe('SELECT id,itemId,lotId,requestedQty,receivedQty,damagedQty,shortageQty,excessQty FROM TransferLine WHERE transferId = ? ORDER BY createdAt,id', input.transferId);
            return { duplicate: true, status: duplicate[0].status, receiptId: duplicate[0].id, ...totals[0], lines };
        }
        const transfers = await tx.$queryRawUnsafe('SELECT status FROM Transfer WHERE id = ? FOR UPDATE', input.transferId);
        if (!transfers[0])
            throw new Error('Transfer was not found.');
        if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'].includes(transfers[0].status)) {
            throw new Error(`Transfer cannot be received while ${transfers[0].status}.`);
        }
        const dbLines = await tx.$queryRawUnsafe('SELECT id,itemId,lotId,requestedQty,receivedQty,damagedQty,shortageQty,excessQty FROM TransferLine WHERE transferId = ? ORDER BY createdAt,id FOR UPDATE', input.transferId);
        const transferLines = dbLines.map((line) => ({
            id: line.id, itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
            receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty), shortageQty: Number(line.shortageQty),
            excessQty: Number(line.excessQty),
        }));
        const summary = (0, receipt_validation_js_1.validateReceiptLines)(transferLines, input.lines);
        const status = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
        const receiptId = `receipt-${(0, node_crypto_1.randomUUID)()}`;
        await tx.$executeRawUnsafe('INSERT INTO TransferReceipt (id,requestId,transferId,receivedById,status,notes) VALUES (?,?,?,?,?,?)', receiptId, input.requestId, input.transferId, input.receivedById, status, input.notes || null);
        for (const line of input.lines) {
            const dbLine = dbLines.find((candidate) => line.lineId ? candidate.id === line.lineId : candidate.itemId === line.itemId && candidate.lotId === line.lotId);
            const excessQty = Number(line.excessQty ?? 0);
            await tx.$executeRawUnsafe('INSERT INTO TransferReceiptLine (id,receiptId,transferLineId,itemId,lotId,receivedQty,damagedQty,shortageQty,excessQty) VALUES (?,?,?,?,?,?,?,?,?)', `receipt-line-${(0, node_crypto_1.randomUUID)()}`, receiptId, dbLine.id, dbLine.itemId, dbLine.lotId, line.receivedQty, line.damagedQty, line.shortageQty, excessQty);
            await tx.$executeRawUnsafe('UPDATE TransferLine SET receivedQty=receivedQty+?, damagedQty=damagedQty+?, shortageQty=shortageQty+?, excessQty=excessQty+?, updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?', line.receivedQty, line.damagedQty, line.shortageQty, excessQty, dbLine.id);
            if (line.receivedQty > 0) {
                await tx.$executeRawUnsafe(`INSERT INTO StockLedger (id,itemId,lotId,locationId,onHand,reserved,inTransit,version,lastUpdatedAt)
           VALUES (?,?,?,?,?,0,0,1,CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE onHand=onHand+VALUES(onHand),version=version+1,lastUpdatedAt=CURRENT_TIMESTAMP(3)`, `ledger-${(0, node_crypto_1.randomUUID)()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, line.receivedQty);
            }
            // Blueprint section 7.2 / Module H: damaged receiving stock is
            // physically on the shelf but not sellable - post it to the
            // quarantine bucket instead of letting it vanish from the ledger.
            // An Exception Inbox case (created by the caller) tracks disposition;
            // resolving that case is what eventually moves it out of quarantine.
            if (line.damagedQty > 0) {
                await tx.$executeRawUnsafe(`INSERT INTO StockLedger (id,itemId,lotId,locationId,onHand,reserved,inTransit,quarantine,version,lastUpdatedAt)
           VALUES (?,?,?,?,0,0,0,?,1,CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE quarantine=quarantine+VALUES(quarantine),version=version+1,lastUpdatedAt=CURRENT_TIMESTAMP(3)`, `ledger-${(0, node_crypto_1.randomUUID)()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, line.damagedQty);
            }
            // Excess receipt: never silently absorbed into onHand. It is
            // physically present, so it also lands in quarantine pending an
            // explicit EXCESS_RECEIPT Exception Inbox accept/reject decision -
            // accept posts it to onHand, reject returns it to the vendor/source.
            if (excessQty > 0) {
                await tx.$executeRawUnsafe(`INSERT INTO StockLedger (id,itemId,lotId,locationId,onHand,reserved,inTransit,quarantine,version,lastUpdatedAt)
           VALUES (?,?,?,?,0,0,0,?,1,CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE quarantine=quarantine+VALUES(quarantine),version=version+1,lastUpdatedAt=CURRENT_TIMESTAMP(3)`, `ledger-${(0, node_crypto_1.randomUUID)()}`, dbLine.itemId, dbLine.lotId, input.destinationLocationId, excessQty);
            }
        }
        await tx.$executeRawUnsafe('UPDATE Transfer SET status=?, notes=CONCAT(COALESCE(notes,? ), ?), updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?', status, '', `\n[RECEIPT ${receiptId}] Good: ${summary.receivedQty}, Damaged: ${summary.damagedQty}, Shortage: ${summary.shortageQty}, Excess: ${summary.excessQty}${input.notes ? `, Notes: ${input.notes}` : ''}`, input.transferId);
        const lines = await tx.$queryRawUnsafe('SELECT id,itemId,lotId,requestedQty,receivedQty,damagedQty,shortageQty,excessQty FROM TransferLine WHERE transferId = ? ORDER BY createdAt,id', input.transferId);
        return { duplicate: false, status, receiptId, ...summary, lines };
    }, { maxWait: 10_000, timeout: 60_000 });
}
