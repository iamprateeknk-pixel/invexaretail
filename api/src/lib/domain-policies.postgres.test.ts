// Tenant and transition proof for the centralized status writers. Skipped
// unless TEST_DATABASE_URL is set; AGENTS.md requires a real Postgres
// negative test for every new tenant-scoped mutation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { transitionTransferStatus } from './domain-policies.js';
import { isDomainError } from './errors.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function makeCompanyFixture() {
  const companyId = `policy-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `policy-user-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Policy test user',
      email: `${userId}@test.invexa.local`,
      passwordHash: 'not-a-real-hash',
      role: 'WAREHOUSE_PICKER',
      assignedLocations: '[]',
      companyId,
    },
  });
  const source = await prisma.location.create({
    data: { code: `src-${randomUUID()}`, name: 'Source', type: 'WAREHOUSE', companyId },
  });
  const destination = await prisma.location.create({
    data: { code: `dst-${randomUUID()}`, name: 'Destination', type: 'STORE', companyId },
  });
  return { companyId, userId, source, destination };
}

integration('transfer status mutation fails closed for another company and succeeds for the owner', async () => {
  const owner = await makeCompanyFixture();
  const other = await makeCompanyFixture();
  const transfer = await prisma.transfer.create({
    data: {
      sourceLocationId: owner.source.id,
      destinationLocationId: owner.destination.id,
      requestedById: owner.userId,
      companyId: owner.companyId,
      status: 'REQUESTED',
    },
  });

  await assert.rejects(
    () => transitionTransferStatus({
      entityId: transfer.id,
      companyId: other.companyId,
      to: 'PICKING',
      role: 'WAREHOUSE_PICKER',
      actorId: other.userId,
    }),
    (error: unknown) => isDomainError(error) && error.code === 'NOT_FOUND',
  );
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status, 'REQUESTED');

  await transitionTransferStatus({
    entityId: transfer.id,
    companyId: owner.companyId,
    to: 'PICKING',
    role: 'WAREHOUSE_PICKER',
    actorId: owner.userId,
  });
  assert.equal((await prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status, 'PICKING');
});
