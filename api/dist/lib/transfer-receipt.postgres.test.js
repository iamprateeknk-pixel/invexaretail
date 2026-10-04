"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Week 6 / guide Week 13: the destination on-hand leg of a transfer receipt
// posts through InventoryPostingService inside the receipt transaction, so the
// StockMovement journal and the StockLedger projection cannot disagree (the
// old raw upsert wrote no journal row at all). Skipped unless
// TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const transfer_receipt_js_1 = require("./transfer-receipt.js");
const persistence_js_1 = require("./persistence.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeTransfer(requested = 10) {
    const companyId = `xfer-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `xfer-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'Xfer', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    const src = await db_js_1.prisma.location.create({ data: { id: `src-${(0, node_crypto_1.randomUUID)()}`, code: `src-${(0, node_crypto_1.randomUUID)()}`, name: 'Src', type: 'warehouse', companyId } });
    const dst = await db_js_1.prisma.location.create({ data: { id: `dst-${(0, node_crypto_1.randomUUID)()}`, code: `dst-${(0, node_crypto_1.randomUUID)()}`, name: 'Dst', type: 'store', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `XF-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Xfer item', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${(0, node_crypto_1.randomUUID)().slice(0, 6)}` } });
    const transfer = await db_js_1.prisma.transfer.create({
        data: { sourceLocationId: src.id, destinationLocationId: dst.id, status: 'DISPATCHED', requestedById: userId, companyId,
            lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: requested }] } },
        include: { lines: true },
    });
    const tenant = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
    return { transfer, item, lot, dst, userId, tenant };
}
const journal = async (itemId, locationId) => (await db_js_1.prisma.stockMovement.findMany({ where: { itemId, locationId } }));
integration('transfer receipt posts a TRANSFER_IN journal row that matches the ledger, and a retry posts nothing more', async () => {
    const f = await makeTransfer(10);
    const requestId = (0, node_crypto_1.randomUUID)();
    const input = {
        requestId, transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
        lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 7, damagedQty: 1, shortageQty: 2, excessQty: 0 }],
    };
    const first = await (0, transfer_receipt_js_1.persistTransferReceipt)(input);
    strict_1.default.equal(first?.duplicate, false);
    strict_1.default.equal(first?.status, 'PARTIAL_RECEIVED');
    const retry = await (0, transfer_receipt_js_1.persistTransferReceipt)(input);
    strict_1.default.equal(retry?.duplicate, true);
    const ledger = await db_js_1.prisma.stockLedger.findMany({ where: { itemId: f.item.id, locationId: f.dst.id } });
    strict_1.default.equal(ledger.length, 1);
    strict_1.default.equal(ledger[0].onHand, 7);
    strict_1.default.equal(ledger[0].quarantine, 1, 'damaged quantity is quarantined, never sellable');
    const rows = await journal(f.item.id, f.dst.id);
    strict_1.default.equal(rows.length, 1, 'one journal row despite the retry');
    strict_1.default.equal(rows[0].movementType, 'TRANSFER_IN');
    strict_1.default.equal(rows[0].qtyDelta, 7);
    strict_1.default.equal(rows[0].companyId, f.tenant.companyId);
    strict_1.default.equal(rows.reduce((sum, r) => sum + r.qtyDelta, 0), ledger[0].onHand, 'journal sum equals projection');
});
integration('a second partial receipt adds a second journal row and the journal still sums to on-hand', async () => {
    const f = await makeTransfer(10);
    const line = (qty, short) => [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: qty, damagedQty: 0, shortageQty: short, excessQty: 0 }];
    const base = { transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant };
    await (0, transfer_receipt_js_1.persistTransferReceipt)({ ...base, requestId: (0, node_crypto_1.randomUUID)(), lines: line(4, 0) });
    await (0, transfer_receipt_js_1.persistTransferReceipt)({ ...base, requestId: (0, node_crypto_1.randomUUID)(), lines: line(6, 0) });
    const ledger = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: f.dst.id } });
    strict_1.default.equal(ledger.onHand, 10);
    const rows = await journal(f.item.id, f.dst.id);
    strict_1.default.equal(rows.length, 2);
    strict_1.default.equal(rows.reduce((sum, r) => sum + r.qtyDelta, 0), 10);
});
integration('a receipt that fails validation leaves no journal row, ledger row or receipt behind', async () => {
    const f = await makeTransfer(5);
    await strict_1.default.rejects((0, transfer_receipt_js_1.persistTransferReceipt)({
        requestId: (0, node_crypto_1.randomUUID)(), transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
        lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 50, damagedQty: 0, shortageQty: 0, excessQty: 0 }],
    }));
    strict_1.default.equal((await journal(f.item.id, f.dst.id)).length, 0);
    strict_1.default.equal(await db_js_1.prisma.stockLedger.count({ where: { itemId: f.item.id, locationId: f.dst.id } }), 0);
    strict_1.default.equal(await db_js_1.prisma.transferReceipt.count({ where: { transferId: f.transfer.id } }), 0);
});
integration('in-transit stock is tracked on the source lot from pick-confirm until the receipt settles it (audit O-7)', async () => {
    const f = await makeTransfer(10);
    const srcId = f.transfer.sourceLocationId;
    await db_js_1.prisma.stockLedger.create({ data: { itemId: f.item.id, lotId: f.lot.id, locationId: srcId, onHand: 10, companyId: f.tenant.companyId } });
    await db_js_1.prisma.transfer.update({ where: { id: f.transfer.id }, data: { status: 'PENDING_PICK' } });
    const alloc = [{ itemId: f.item.id, lotId: f.lot.id, locationId: srcId, quantity: 10 }];
    await (0, persistence_js_1.persistConfirmedPickAllocations)(f.transfer.id, alloc, f.tenant);
    const afterConfirm = await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } });
    strict_1.default.equal(afterConfirm.onHand, 0);
    strict_1.default.equal(afterConfirm.inTransit, 10, 'the 10 units are in flight, not vanished');
    await strict_1.default.rejects((0, persistence_js_1.persistConfirmedPickAllocations)(f.transfer.id, alloc, f.tenant), /already confirmed/);
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit, 10, 'a rejected replay does not double it');
    await db_js_1.prisma.transfer.update({ where: { id: f.transfer.id }, data: { status: 'DISPATCHED' } });
    const receive = (requestId, receivedQty, shortageQty) => (0, transfer_receipt_js_1.persistTransferReceipt)({
        requestId, transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
        lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty, damagedQty: 0, shortageQty, excessQty: 0 }],
    });
    await receive((0, node_crypto_1.randomUUID)(), 6, 0);
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit, 4, 'partial receipt releases only what arrived');
    await receive((0, node_crypto_1.randomUUID)(), 3, 1);
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit, 0, 'received + short settles the rest');
});
integration('a transfer confirmed before in-transit tracking existed does not disturb another transfer\'s in-transit', async () => {
    const f = await makeTransfer(5);
    const srcId = f.transfer.sourceLocationId;
    await db_js_1.prisma.stockLedger.create({ data: { itemId: f.item.id, lotId: f.lot.id, locationId: srcId, onHand: 0, inTransit: 8, companyId: f.tenant.companyId } });
    await (0, transfer_receipt_js_1.persistTransferReceipt)({
        requestId: (0, node_crypto_1.randomUUID)(), transferId: f.transfer.id, destinationLocationId: f.dst.id, receivedById: f.userId, notes: '', tenant: f.tenant,
        lines: [{ lineId: f.transfer.lines[0].id, itemId: f.item.id, lotId: f.lot.id, receivedQty: 5, damagedQty: 0, shortageQty: 0, excessQty: 0 }],
    });
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: f.item.id, locationId: srcId } })).inTransit, 8);
});
