"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const import_reversal_js_1 = require("./import-reversal.js");
const integration = process.env.TEST_DATABASE_URL ? node_test_1.default : node_test_1.default.skip;
async function fixture() {
    const companyId = `reversal-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `reversal-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({ data: { id: userId, name: 'Importer', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
    const location = await db_js_1.prisma.location.create({ data: { id: `reversal-loc-${(0, node_crypto_1.randomUUID)()}`, code: `REV-${(0, node_crypto_1.randomUUID)()}`, name: 'Warehouse', type: 'warehouse', companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `REV-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Item', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: location.id, onHand: 10, companyId } });
    const batch = await db_js_1.prisma.importBatch.create({ data: {
            id: `reversal-batch-${(0, node_crypto_1.randomUUID)()}`, type: 'PURCHASE', fileName: 'purchase.csv', sourceFormat: 'csv', importedById: userId,
            totalRows: 1, validRows: 1, invalidRows: 0, status: 'POSTED', companyId,
        } });
    await db_js_1.prisma.inventoryMovement.create({ data: {
            id: `reversal-movement-${(0, node_crypto_1.randomUUID)()}`, dedupeKey: `reversal-source-${(0, node_crypto_1.randomUUID)()}`, itemId: item.id, lotId: lot.id,
            locationId: location.id, movementType: 'PURCHASE', qtyDelta: 5, transactionAt: new Date(), sourceType: 'PURCHASE',
            sourceReference: batch.id, importBatchId: batch.id, createdById: userId,
        } });
    return { companyId, userId, location, item, lot, batch };
}
integration('legacy import history and reversal are tenant-scoped, while the owner can reverse once', async () => {
    const owner = await fixture();
    const other = await fixture();
    strict_1.default.ok((await (0, import_reversal_js_1.listImportBatches)(owner.companyId)).some((batch) => batch.id === owner.batch.id));
    strict_1.default.ok(!(await (0, import_reversal_js_1.listImportBatches)(other.companyId)).some((batch) => batch.id === owner.batch.id));
    await strict_1.default.rejects((0, import_reversal_js_1.reverseImportBatch)({ batchId: owner.batch.id, companyId: other.companyId, actorId: other.userId, reason: 'wrong tenant attempt' }), /not found/i);
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: owner.item.id, locationId: owner.location.id } })).onHand, 10);
    const result = await (0, import_reversal_js_1.reverseImportBatch)({ batchId: owner.batch.id, companyId: owner.companyId, actorId: owner.userId, reason: 'approved correction' });
    strict_1.default.equal(result.duplicate, false);
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { itemId: owner.item.id, locationId: owner.location.id } })).onHand, 5);
    strict_1.default.equal((await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: owner.batch.id } })).status, 'REVERSED');
    strict_1.default.equal((await db_js_1.prisma.importBatch.findUniqueOrThrow({ where: { id: result.reversalBatchId } })).companyId, owner.companyId);
});
