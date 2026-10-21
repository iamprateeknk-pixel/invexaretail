// ADR-001 / Week 6: the canonical InventoryPostingService, exercised
// against real Postgres. Skipped unless TEST_DATABASE_URL is set (see
// AGENTS.md "Required tests").
//
// Phase 2/3 updates: quantities come back as Prisma Decimals, so numeric
// assertions go through Number(...); ledger lookups use the
// tenant-qualified compound key (companyId first).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import {
  postInventoryMovement,
  reverseInventoryMovement,
  NegativeStockBlockedError,
  AlreadyReversedError,
} from './inventory-posting-service.js';
import type { TenantContext } from './tenant-context.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture(companyId = `posting-test-${randomUUID()}`) {
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `posting-test-user-${randomUUID()}`;
  await prisma.user.create({
    data: { id: userId, name: 'Posting Test User', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  const locationId = `posting-test-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `posting-test-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Posting Test Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  const tenant: TenantContext = { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
  return { tenant, locationId, itemId, lotId: lot.id };
}

integration('posting an opening-stock movement creates the journal row and the StockLedger projection together', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  const result = await postInventoryMovement({
    tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 10,
    reason: 'Initial stock', idempotencyKey: randomUUID(),
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.balance.onHand, 10);

  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.onHand), 10);
  const movement = await prisma.stockMovement.findUnique({ where: { id: result.movement.id } });
  assert.equal(Number(movement?.qtyDelta), 10);
  assert.equal(Number(movement?.beforeBalance), 0);
  assert.equal(Number(movement?.afterBalance), 10);
});

integration('a duplicate idempotency key returns the original result and does not post twice', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  const key = randomUUID();
  const first = await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 5, reason: 'r', idempotencyKey: key });
  const second = await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 5, reason: 'r', idempotencyKey: key });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.movement.id, first.movement.id);

  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.onHand), 5, 'onHand must reflect exactly one post, not two');
  const movementCount = await prisma.stockMovement.count({ where: { idempotencyKey: key } });
  assert.equal(movementCount, 1);
});

integration('two concurrent posts to the same item/lot/location both succeed and the projection sums correctly', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 100, reason: 'seed', idempotencyKey: randomUUID() });

  const [a, b] = await Promise.all([
    postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -10, reason: 'sale A', idempotencyKey: randomUUID() }),
    postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -5, reason: 'sale B', idempotencyKey: randomUUID() }),
  ]);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, false);

  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.onHand), 85, 'both concurrent deltas must be applied - neither write can silently overwrite the other');

  const movements = await prisma.stockMovement.findMany({ where: { itemId, lotId, locationId } });
  const journalSum = movements.reduce((sum, m) => sum + Number(m.qtyDelta), 0);
  assert.equal(journalSum, 85, 'journal sum must equal the projection');
});

integration('negative stock is blocked by default policy', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 3, reason: 'seed', idempotencyKey: randomUUID() });
  await assert.rejects(
    () => postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'SALES_DEDUCTION', qtyDelta: -10, reason: 'oversell attempt', idempotencyKey: randomUUID() }),
    NegativeStockBlockedError,
  );
  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.onHand), 3, 'a blocked post must not change the balance');
});

integration('reversal posts an equal-and-opposite movement and never edits the original', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  const posted = await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'ADJUSTMENT', qtyDelta: 20, reason: 'adjustment', idempotencyKey: randomUUID() });

  const reversed = await reverseInventoryMovement(tenant, posted.movement.id, 'undo the adjustment');
  assert.equal(reversed.duplicate, false);
  assert.equal(Number(reversed.movement.qtyDelta), -20);
  assert.equal((reversed.movement.metadata as { reversalOf?: string } | null)?.reversalOf, posted.movement.id);

  const original = await prisma.stockMovement.findUnique({ where: { id: posted.movement.id } });
  assert.equal(Number(original?.qtyDelta), 20, 'the original movement row must be unchanged');
  assert.equal(original?.metadata, null, 'the original movement is never edited to point at its reversal');

  const ledger = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId, locationId } } });
  assert.equal(Number(ledger?.onHand), 0, 'the reversal must net the balance back to zero');

  await assert.rejects(() => reverseInventoryMovement(tenant, posted.movement.id, 'try again'), AlreadyReversedError);
});

integration('retrying a reversal request is itself idempotent', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  const posted = await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'ADJUSTMENT', qtyDelta: 7, reason: 'adjustment', idempotencyKey: randomUUID() });
  // Simulate a client retrying a reversal it thinks may not have landed: call
  // postInventoryMovement directly with the same derived key a second time.
  const key = `reversal:${posted.movement.id}`;
  const first = await prisma.stockMovement.findFirst({ where: { idempotencyKey: key } });
  assert.equal(first, null);
  const reversed = await reverseInventoryMovement(tenant, posted.movement.id, 'undo');
  const retried = await postInventoryMovement({
    tenant, itemId, lotId, locationId, movementType: 'ADJUSTMENT', qtyDelta: -7, reason: 'undo', idempotencyKey: key,
  });
  assert.equal(retried.duplicate, true);
  assert.equal(retried.movement.id, reversed.movement.id);
});

integration('lot and location keys stay isolated: posting for lot A never touches lot B\'s balance', async () => {
  const { tenant, locationId, itemId, lotId } = await makeFixture();
  const lotB = await prisma.lot.create({ data: { itemId, lotNo: `LOT-B-${randomUUID().slice(0, 8)}` } });

  await postInventoryMovement({ tenant, itemId, lotId, locationId, movementType: 'OPENING_STOCK', qtyDelta: 10, reason: 'lot A', idempotencyKey: randomUUID() });
  await postInventoryMovement({ tenant, itemId, lotId: lotB.id, locationId, movementType: 'OPENING_STOCK', qtyDelta: 40, reason: 'lot B', idempotencyKey: randomUUID() });

  const ledgerA = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId, locationId } } });
  const ledgerB = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: tenant.companyId, itemId, lotId: lotB.id, locationId } } });
  assert.equal(Number(ledgerA?.onHand), 10);
  assert.equal(Number(ledgerB?.onHand), 40);
});

integration('tenant isolation: an idempotency key is scoped per company, not global', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();
  const sharedKey = randomUUID();

  const postedA = await postInventoryMovement({ tenant: fixtureA.tenant, itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId, movementType: 'OPENING_STOCK', qtyDelta: 1, reason: 'A', idempotencyKey: sharedKey });
  const postedB = await postInventoryMovement({ tenant: fixtureB.tenant, itemId: fixtureB.itemId, lotId: fixtureB.lotId, locationId: fixtureB.locationId, movementType: 'OPENING_STOCK', qtyDelta: 2, reason: 'B', idempotencyKey: sharedKey });

  assert.equal(postedA.duplicate, false);
  assert.equal(postedB.duplicate, false, 'the same idempotency key under a different tenant must post independently');
  assert.notEqual(postedA.movement.id, postedB.movement.id);
});

integration('tenant-qualified ledger key: posting under company B creates its own row and never increments company A\'s', async () => {
  const fixtureA = await makeFixture();
  const fixtureB = await makeFixture();

  await postInventoryMovement({ tenant: fixtureA.tenant, itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId, movementType: 'OPENING_STOCK', qtyDelta: 10, reason: 'A seed', idempotencyKey: randomUUID() });
  await postInventoryMovement({ tenant: fixtureB.tenant, itemId: fixtureB.itemId, lotId: fixtureB.lotId, locationId: fixtureB.locationId, movementType: 'OPENING_STOCK', qtyDelta: 4, reason: 'B seed', idempotencyKey: randomUUID() });

  const ledgerA = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: fixtureA.tenant.companyId, itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId } } });
  const ledgerB = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: fixtureB.tenant.companyId, itemId: fixtureB.itemId, lotId: fixtureB.lotId, locationId: fixtureB.locationId } } });
  assert.equal(Number(ledgerA?.onHand), 10, 'company A balance must be untouched by company B posting');
  assert.equal(Number(ledgerB?.onHand), 4, 'company B must get its own ledger row, not an increment of A\'s');
  assert.notEqual(ledgerA?.id, ledgerB?.id);

  const crossLookup = await prisma.stockLedger.findUnique({ where: { companyId_itemId_lotId_locationId: { companyId: fixtureB.tenant.companyId, itemId: fixtureA.itemId, lotId: fixtureA.lotId, locationId: fixtureA.locationId } } });
  assert.equal(crossLookup, null, 'a lookup under the wrong company must find nothing, never the other company\'s row');
});
