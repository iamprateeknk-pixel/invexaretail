import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { hydrateRepositoryFromDatabase } from './persistence.js';
import { listLocations, listUsers } from './repository.js';
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
