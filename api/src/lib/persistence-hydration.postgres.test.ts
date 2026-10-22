import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { hydrateRepositoryFromDatabase } from './persistence.js';
import { listLocations, listStockLedgerForLocation, listUsers } from './repository.js';
import { DEFAULT_COMPANY_ID } from './saas/tenant-scope.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('startup hydration keeps default-company rows when the singleton profile id is default', async () => {
  const suffix = randomUUID();
  const locationId = `hydrate-location-${suffix}`;
  const userId = `hydrate-user-${suffix}`;

  await prisma.companyProfile.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', name: 'InvexaRetail' },
  });
  await prisma.location.create({
    data: {
      id: locationId,
      code: `HYDRATE-${suffix}`,
      name: 'Hydration Regression Branch',
      type: 'store',
      companyId: DEFAULT_COMPANY_ID,
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Hydration Regression User',
      email: `${userId}@test.invexa.local`,
      passwordHash: 'not-used',
      role: 'ADMIN',
      assignedLocations: JSON.stringify([locationId]),
      companyId: DEFAULT_COMPANY_ID,
    },
  });

  try {
    await hydrateRepositoryFromDatabase();
    assert.ok(listLocations().some((location) => location.id === locationId));
    assert.ok(listUsers().some((user) => user.id === userId));
  } finally {
    await prisma.user.deleteMany({ where: { id: userId, companyId: DEFAULT_COMPANY_ID } });
    await prisma.location.deleteMany({ where: { id: locationId, companyId: DEFAULT_COMPANY_ID } });
  }
});

integration('startup hydration does NOT load stock into the snapshot (Phase 5 step 15)', async () => {
  const suffix = randomUUID();
  const locationId = `hydrate-stock-location-${suffix}`;
  const itemId = `hydrate-stock-item-${suffix}`;

  await prisma.location.create({
    data: { id: locationId, code: `HYDRATE-STOCK-${suffix}`, name: 'Hydration Stock Branch', type: 'store', companyId: DEFAULT_COMPANY_ID },
  });
  await prisma.item.create({
    data: { id: itemId, code: itemId, name: 'Hydration Stock Item', unit: 'ea', companyId: DEFAULT_COMPANY_ID },
  });
  const lot = await prisma.lot.create({ data: { itemId, lotNo: `HYDRATE-LOT-${suffix.slice(0, 8)}` } });
  await prisma.stockLedger.create({
    data: { companyId: DEFAULT_COMPANY_ID, itemId, lotId: lot.id, locationId, onHand: 9 },
  });

  try {
    await hydrateRepositoryFromDatabase();
    // Documents still hydrate; stock deliberately does not — every stock
    // read goes to the database through the stock repository.
    assert.ok(listLocations().some((location) => location.id === locationId));
    assert.deepEqual(listStockLedgerForLocation(locationId), []);
  } finally {
    await prisma.stockLedger.deleteMany({ where: { itemId, companyId: DEFAULT_COMPANY_ID } });
    await prisma.lot.deleteMany({ where: { id: lot.id } });
    await prisma.item.deleteMany({ where: { id: itemId, companyId: DEFAULT_COMPANY_ID } });
    await prisma.location.deleteMany({ where: { id: locationId, companyId: DEFAULT_COMPANY_ID } });
  }
});
