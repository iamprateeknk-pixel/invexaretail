"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ADR-001 / Week 6: the canonical InventoryPostingService, exercised
// against real Postgres. Skipped unless TEST_DATABASE_URL is set (see
// AGENTS.md "Required tests").
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const inventory_posting_service_js_1 = require("./inventory-posting-service.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeFixture(companyId = `posting-test-${(0, node_crypto_1.randomUUID)()}`) {
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `posting-test-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: { id: userId, name: 'Posting Test User', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
    });
    const locationId = `posting-test-loc-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
    const itemId = `posting-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({ data: { id: itemId, code: itemId, name: 'Posting Test Item', unit: 'ea', companyId } });
    const lot = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    const tenant = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
    return { tenant, locationId, itemId, lotId: lot.id };
}
integration('posting an opening-stock movement creates the journal row and the StockLedger projection together', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    const result = await (0, inventory_posting_service_js_1.postInventoryMovement)({
        tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 10,
        reason: 'Initial stock', idempotencyKey: (0, node_crypto_1.randomUUID)(),
    });
    strict_1.default.equal(result.duplicate, false);
    strict_1.default.equal(result.balance.onHand, 10);
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.onHand, 10);
    const movement = await db_js_1.prisma.stockMovement.findUnique({ where: { id: result.movement.id } });
    strict_1.default.equal(movement?.qtyDelta, 10);
    strict_1.default.equal(movement?.beforeBalance, 0);
    strict_1.default.equal(movement?.afterBalance, 10);
});
integration('a duplicate idempotency key returns the original result and does not post twice', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    const key = (0, node_crypto_1.randomUUID)();
    const first = await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 5, reason: 'r', idempotencyKey: key });
    const second = await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 5, reason: 'r', idempotencyKey: key });
    strict_1.default.equal(first.duplicate, false);
    strict_1.default.equal(second.duplicate, true);
    strict_1.default.equal(second.movement.id, first.movement.id);
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.onHand, 5, 'onHand must reflect exactly one post, not two');
    const movementCount = await db_js_1.prisma.stockMovement.count({ where: { idempotencyKey: key } });
    strict_1.default.equal(movementCount, 1);
});
integration('two concurrent posts to the same item/lot/location both succeed and the projection sums correctly', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 100, reason: 'seed', idempotencyKey: (0, node_crypto_1.randomUUID)() });
    const [a, b] = await Promise.all([
        (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -10, reason: 'sale A', idempotencyKey: (0, node_crypto_1.randomUUID)() }),
        (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -5, reason: 'sale B', idempotencyKey: (0, node_crypto_1.randomUUID)() }),
    ]);
    strict_1.default.equal(a.duplicate, false);
    strict_1.default.equal(b.duplicate, false);
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.onHand, 85, 'both concurrent deltas must be applied - neither write can silently overwrite the other');
    const movements = await db_js_1.prisma.stockMovement.findMany({ where: { itemId, lotId, locationId } });
    const journalSum = movements.reduce((sum, m) => sum + m.qtyDelta, 0);
    strict_1.default.equal(journalSum, 85, 'journal sum must equal the projection');
});
integration('negative stock is blocked by default policy', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 3, reason: 'seed', idempotencyKey: (0, node_crypto_1.randomUUID)() });
    await strict_1.default.rejects(() => (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -10, reason: 'oversell attempt', idempotencyKey: (0, node_crypto_1.randomUUID)() }), inventory_posting_service_js_1.NegativeStockBlockedError);
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.onHand, 3, 'a blocked post must not change the balance');
});
integration('reversal posts an equal-and-opposite movement and never edits the original', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    const posted = await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'ADJUSTMENT', qtyDelta: 20, reason: 'adjustment', idempotencyKey: (0, node_crypto_1.randomUUID)() });
    const reversed = await (0, inventory_posting_service_js_1.reverseInventoryMovement)(tenant, posted.movement.id, 'undo the adjustment');
    strict_1.default.equal(reversed.duplicate, false);
    strict_1.default.equal(reversed.movement.qtyDelta, -20);
    strict_1.default.equal(reversed.movement.metadata?.reversalOf, posted.movement.id);
    const original = await db_js_1.prisma.stockMovement.findUnique({ where: { id: posted.movement.id } });
    strict_1.default.equal(original?.qtyDelta, 20, 'the original movement row must be unchanged');
    strict_1.default.equal(original?.metadata, null, 'the original movement is never edited to point at its reversal');
    const ledger = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    strict_1.default.equal(ledger?.onHand, 0, 'the reversal must net the balance back to zero');
    await strict_1.default.rejects(() => (0, inventory_posting_service_js_1.reverseInventoryMovement)(tenant, posted.movement.id, 'try again'), inventory_posting_service_js_1.AlreadyReversedError);
});
integration('retrying a reversal request is itself idempotent', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    const posted = await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'ADJUSTMENT', qtyDelta: 7, reason: 'adjustment', idempotencyKey: (0, node_crypto_1.randomUUID)() });
    // Simulate a client retrying a reversal it thinks may not have landed: call
    // postInventoryMovement directly with the same derived key a second time.
    const key = `reversal:${posted.movement.id}`;
    const first = await db_js_1.prisma.stockMovement.findFirst({ where: { idempotencyKey: key } });
    strict_1.default.equal(first, null);
    const reversed = await (0, inventory_posting_service_js_1.reverseInventoryMovement)(tenant, posted.movement.id, 'undo');
    const retried = await (0, inventory_posting_service_js_1.postInventoryMovement)({
        tenant, itemId, lotId, locationId, movementType: 'ADJUSTMENT', qtyDelta: -7, reason: 'undo', idempotencyKey: key,
    });
    strict_1.default.equal(retried.duplicate, true);
    strict_1.default.equal(retried.movement.id, reversed.movement.id);
});
integration('lot and location keys stay isolated: posting for lot A never touches lot B\'s balance', async () => {
    const { tenant, locationId, itemId, lotId } = await makeFixture();
    const lotB = await db_js_1.prisma.lot.create({ data: { itemId, lotNo: `LOT-B-${(0, node_crypto_1.randomUUID)().slice(0, 8)}` } });
    await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 10, reason: 'lot A', idempotencyKey: (0, node_crypto_1.randomUUID)() });
    await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant, itemId, lotId: lotB.id, locationId, movementType: 'OPENING_STOCK', qtyDelta: 40, reason: 'lot B', idempotencyKey: (0, node_crypto_1.randomUUID)() });
    const ledgerA = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId, locationId } } });
    const ledgerB = await db_js_1.prisma.stockLedger.findUnique({ where: { itemId_lotId_locationId: { itemId, lotId: lotB.id, locationId } } });
    strict_1.default.equal(ledgerA?.onHand, 10);
    strict_1.default.equal(ledgerB?.onHand, 40);
});
integration('tenant isolation: an idempotency key is scoped per company, not global', async () => {
    const fixtureA = await makeFixture();
    const fixtureB = await makeFixture();
    const sharedKey = (0, node_crypto_1.randomUUID)();
    const postedA = await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant: fixtureA.tenant, itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId, movementType: 'OPENING_STOCK', qtyDelta: 1, reason: 'A', idempotencyKey: sharedKey });
    const postedB = await (0, inventory_posting_service_js_1.postInventoryMovement)({ tenant: fixtureB.tenant, itemId: fixtureB.itemId, lotId: fixtureB.lotId, locationId: fixtureB.locationId, movementType: 'OPENING_STOCK', qtyDelta: 2, reason: 'B', idempotencyKey: sharedKey });
    strict_1.default.equal(postedA.duplicate, false);
    strict_1.default.equal(postedB.duplicate, false, 'the same idempotency key under a different tenant must post independently');
    strict_1.default.notEqual(postedA.movement.id, postedB.movement.id);
});
