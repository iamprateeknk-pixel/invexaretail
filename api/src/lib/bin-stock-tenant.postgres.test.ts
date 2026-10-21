// Phase 3 (R3) negative coverage for bin-level stock: BinStock and
// BinMovement rows must carry their company, and one company's bin stock
// must be invisible and untouchable under another company's key.
// Exercised against real Postgres; skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { persistBinStockDelta, moveBinStockPersisted, STAGING_BIN_ID } from './bin-stock.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture() {
  const companyId = `bin-tenant-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const locationId = `bin-tenant-loc-${randomUUID()}`;
  await prisma.location.create({ data: { id: locationId, code: locationId, name: 'Test Loc', type: 'store', companyId } });
  const itemId = `bin-tenant-item-${randomUUID()}`;
  await prisma.item.create({ data: { id: itemId, code: itemId, name: 'Bin Tenant Item', unit: 'ea', companyId } });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${randomUUID().slice(0, 8)}` } });
  return { companyId, locationId, itemId, lotId: lot.id };
}

integration('a bin delta lands under its own company and is invisible under another company\'s key', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await persistBinStockDelta({
    companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId,
    binId: STAGING_BIN_ID, qtyDelta: 12,
  });

  const rowA = await prisma.binStock.findUnique({
    where: { companyId_itemId_lotId_locationId_binId: { companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, binId: STAGING_BIN_ID } },
  });
  assert.ok(rowA, 'the delta must create a BinStock row');
  assert.equal(rowA.companyId, a.companyId);
  assert.equal(Number(rowA.onHand), 12);

  const rowUnderB = await prisma.binStock.findUnique({
    where: { companyId_itemId_lotId_locationId_binId: { companyId: b.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, binId: STAGING_BIN_ID } },
  });
  assert.equal(rowUnderB, null, 'the same tuple under company B must find nothing');

  const bRows = await prisma.binStock.count({ where: { companyId: b.companyId } });
  assert.equal(bRows, 0, 'company B must have no bin stock rows at all');
});

integration('a bin move records its movement under the moving company and leaves other companies untouched', async () => {
  const a = await makeFixture();
  const b = await makeFixture();

  await persistBinStockDelta({
    companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId,
    binId: STAGING_BIN_ID, qtyDelta: 20,
  });
  const movement = await moveBinStockPersisted({
    companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId,
    binId: STAGING_BIN_ID, toBinId: 'A-01', quantity: 8,
  });

  const movementRow = await prisma.binMovement.findUnique({ where: { id: movement.id } });
  assert.ok(movementRow, 'the move must persist a BinMovement row');
  assert.equal(movementRow.companyId, a.companyId, 'the movement audit row must name its company');
  assert.equal(Number(movementRow.quantity), 8);

  const targetRow = await prisma.binStock.findUnique({
    where: { companyId_itemId_lotId_locationId_binId: { companyId: a.companyId, itemId: a.itemId, lotId: a.lotId, locationId: a.locationId, binId: 'A-01' } },
  });
  assert.equal(Number(targetRow?.onHand), 8);

  const bMovements = await prisma.binMovement.count({ where: { companyId: b.companyId } });
  assert.equal(bMovements, 0, 'company B must have no bin movements');
  const bRows = await prisma.binStock.count({ where: { companyId: b.companyId } });
  assert.equal(bRows, 0, 'company B bin stock must be untouched by company A\'s move');
});
