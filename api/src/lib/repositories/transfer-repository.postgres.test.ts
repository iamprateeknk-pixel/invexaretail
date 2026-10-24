// ULTRA P1 (issue #184): transfers read from Postgres per company instead of the in-memory snapshot.
// Proves tenant isolation (source-company AND destination-company visibility), parity with the hydrated
// snapshot for the same company, post-boot visibility without hydration, and carton scoping.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { transfers as snapshotTransfers, transferCartons as snapshotCartons } from '../repository.js';
import { findTransferForCompany, listTransferCartonsForTransfers, listTransfersForCompany } from './transfer-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration: typeof test = process.env.TEST_DATABASE_URL ? test : (test as unknown as { skip: typeof test }).skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany() {
  const id = `transfer-repo-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const user = await prisma.user.create({
    data: { id: `${id}-user`, name: 'Requester', email: `${id}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId: id },
  });
  const source = await prisma.location.create({ data: { code: `S-${randomUUID().slice(0, 8)}`, name: `${id} source`, type: 'warehouse', companyId: id } });
  const destination = await prisma.location.create({ data: { code: `D-${randomUUID().slice(0, 8)}`, name: `${id} dest`, type: 'store', companyId: id } });
  const item = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Moved item', companyId: id } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `LOT-${randomUUID().slice(0, 6)}` } });
  return { id, userId: user.id, sourceId: source.id, destinationId: destination.id, itemId: item.id, lotId: lot.id };
}

const addTransfer = (
  c: Awaited<ReturnType<typeof makeCompany>>,
  overrides: { sourceLocationId?: string; destinationLocationId?: string; companyId?: string } = {},
) =>
  prisma.transfer.create({
    data: {
      sourceLocationId: overrides.sourceLocationId ?? c.sourceId,
      destinationLocationId: overrides.destinationLocationId ?? c.destinationId,
      requestedById: c.userId,
      status: 'REQUESTED',
      companyId: overrides.companyId ?? c.id,
      lines: { create: [{ itemId: c.itemId, lotId: c.lotId, requestedQty: 5, receivedQty: 1 }] },
    },
    include: { lines: true },
  });

integration("returns only the caller's transfers — own as source or as destination — oldest first, with mapped lines", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const first = await addTransfer(a);
  const second = await addTransfer(a, { companyId: b.id }); // a is only the destination company here
  const foreign = await addTransfer(b);

  const mine = await listTransfersForCompany(ctxFor(a.id));
  assert.deepEqual(mine.map((row) => row.id), [first.id, second.id]);
  assert.equal(mine[0].requestedBy, a.userId);
  assert.equal(mine[0].role, 'ADMIN');
  assert.deepEqual(mine[0].lines, [{ itemId: a.itemId, lotId: a.lotId, quantity: 5, receivedQty: 1, damagedQty: 0, shortageQty: 0 }]);
  assert.ok(!mine.some((row) => row.id === foreign.id));
  assert.deepEqual((await listTransfersForCompany(ctxFor(b.id))).map((row) => row.id).sort(), [foreign.id, second.id].sort());
});

integration('findTransferForCompany: own transfer found; foreign and missing are both null', async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const own = await addTransfer(a);
  const foreign = await addTransfer(b);

  assert.equal((await findTransferForCompany(ctxFor(a.id), own.id))?.id, own.id);
  assert.equal(await findTransferForCompany(ctxFor(a.id), foreign.id), null);
  assert.equal(await findTransferForCompany(ctxFor(a.id), `missing-${randomUUID()}`), null);
});

integration('parity: equals the hydrated snapshot for the same company, and cartons come scoped through their transfer', async () => {
  const c = await makeCompany();
  const transfer = await addTransfer(c);
  const carton = await prisma.transferCarton.create({
    data: {
      transferId: transfer.id,
      cartonNumber: `CTN-${randomUUID().slice(0, 6)}`,
      quantity: 5,
      status: 'SEALED',
      contents: { lines: [{ itemId: c.itemId, lotId: c.lotId, quantity: 5 }], packedById: c.userId, sealedAt: '2026-10-24T00:00:00.000Z' },
    },
  });

  await hydrateRepositoryFromDatabase();
  const fromDb = await listTransfersForCompany(ctxFor(c.id));
  const fromSnapshot = snapshotTransfers.filter((row) => row.id === transfer.id);
  assert.equal(fromDb.length, 1);
  assert.deepEqual(fromDb, fromSnapshot);

  const cartons = await listTransferCartonsForTransfers(ctxFor(c.id), [transfer.id]);
  assert.deepEqual(cartons.map((row) => row.id), [carton.id]);
  assert.deepEqual(cartons, snapshotCartons.filter((row) => row.id === carton.id));
  assert.equal(cartons[0].packageId, carton.cartonNumber);
  assert.deepEqual(await listTransferCartonsForTransfers(ctxFor(`transfer-repo-${randomUUID()}`), [transfer.id]), [], "another company gets no cartons for this transfer");
});

integration('post-boot visibility: a transfer created after hydration is listed without re-hydrating', async () => {
  const c = await makeCompany();
  await hydrateRepositoryFromDatabase();
  const created = await addTransfer(c);
  assert.ok(!snapshotTransfers.some((row) => row.id === created.id), 'the snapshot does not have it yet');
  assert.deepEqual((await listTransfersForCompany(ctxFor(c.id))).map((row) => row.id), [created.id]);
});
