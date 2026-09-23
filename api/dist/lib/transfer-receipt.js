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
const memoryReceipts = new Map();
const inFlight = new Set();
function rememberReceipt(receipt) {
    memoryReceipts.set(receipt.requestId, receipt);
}
function beginReceiptRequest(requestId) {
    if (inFlight.has(requestId))
        return false;
    inFlight.add(requestId);
    return true;
}
function endReceiptRequest(requestId) {
    inFlight.delete(requestId);
}
async function receiptTotals(receiptId) {
    const totals = await db_js_1.prisma.transferReceiptLine.aggregate({
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
async function findReceiptByRequestId(requestId) {
    const remembered = memoryReceipts.get(requestId);
    if (remembered)
        return remembered;
    if (!persistence_js_1.databaseEnabled)
        return null;
    const row = await db_js_1.prisma.transferReceipt.findUnique({ where: { requestId } });
    if (!row)
        return null;
    const totals = await receiptTotals(row.id);
    return {
        requestId,
        transferId: row.transferId,
        receiptId: row.id,
        status: row.status,
        receivedBy: row.receivedById,
        receivedAt: row.createdAt.toISOString(),
        ...totals,
        notes: row.notes ?? undefined,
    };
}
async function persistTransferReceipt(input) {
    if (!persistence_js_1.databaseEnabled)
        return null;
    return db_js_1.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRawUnsafe('SELECT "id" FROM "Transfer" WHERE "id" = $1 FOR UPDATE', input.transferId);
        if (!locked[0])
            throw new Error('Transfer was not found.');
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
                status: duplicate.status,
                receiptId: duplicate.id,
                receivedQty: Number(totals._sum.receivedQty ?? 0),
                damagedQty: Number(totals._sum.damagedQty ?? 0),
                shortageQty: Number(totals._sum.shortageQty ?? 0),
                excessQty: Number(totals._sum.excessQty ?? 0),
                lines,
            };
        }
        const transfer = await tx.transfer.findUnique({ where: { id: input.transferId }, select: { status: true, notes: true } });
        if (!transfer)
            throw new Error('Transfer was not found.');
        if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED'].includes(transfer.status)) {
            throw new Error(`Transfer cannot be received while ${transfer.status}.`);
        }
        const dbLines = await tx.transferLine.findMany({
            where: { transferId: input.transferId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, itemId: true, lotId: true, requestedQty: true, receivedQty: true, damagedQty: true, shortageQty: true, excessQty: true },
        });
        const transferLines = dbLines.map((line) => ({
            id: line.id, itemId: line.itemId, lotId: line.lotId, quantity: Number(line.requestedQty),
            receivedQty: Number(line.receivedQty), damagedQty: Number(line.damagedQty),
            shortageQty: Number(line.shortageQty), excessQty: Number(line.excessQty),
        }));
        const summary = (0, receipt_validation_js_1.validateReceiptLines)(transferLines, input.lines);
        const status = summary.complete && !summary.hasDiscrepancy ? 'RECEIVED' : 'PARTIAL_RECEIVED';
        const receiptId = `receipt-${(0, node_crypto_1.randomUUID)()}`;
        await tx.transferReceipt.create({
            data: { id: receiptId, requestId: input.requestId, transferId: input.transferId, receivedById: input.receivedById, status, notes: input.notes || null },
        });
        for (const line of input.lines) {
            const dbLine = dbLines.find((candidate) => line.lineId ? candidate.id === line.lineId : candidate.itemId === line.itemId && candidate.lotId === line.lotId);
            const excessQty = Number(line.excessQty ?? 0);
            await tx.transferReceiptLine.create({
                data: {
                    id: `receipt-line-${(0, node_crypto_1.randomUUID)()}`, receiptId, transferLineId: dbLine.id,
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
                    create: { id: `ledger-${(0, node_crypto_1.randomUUID)()}`, itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId, onHand: line.receivedQty, version: 1 },
                    update: { onHand: { increment: line.receivedQty }, version: { increment: 1 } },
                });
            }
            const quarantineQty = line.damagedQty + excessQty;
            if (quarantineQty > 0) {
                await tx.stockLedger.upsert({
                    where: { itemId_lotId_locationId: { itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId } },
                    create: { id: `ledger-${(0, node_crypto_1.randomUUID)()}`, itemId: dbLine.itemId, lotId: dbLine.lotId, locationId: input.destinationLocationId, quarantine: quarantineQty, version: 1 },
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
