// ULTRA P1 (issue #184): the reconciler's delta refresh. One sequential scenario, because the
// watermarks and tick counter are module state: full hydration seeds the watermarks, later
// database writes must reach the snapshot through refreshRepositoryDeltaFromDatabase ALONE
// (updates, nested lot/line changes, inserts), a hard delete must fall back to a full
// hydration, and the stats must say which mode actually ran.
// Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { deltaRefreshStats, hydrateRepositoryFromDatabase, refreshRepositoryDeltaFromDatabase } from './persistence.js';
import { items as snapshotItems, locations as snapshotLocations, transfers as snapshotTransfers } from './repository.js';

const integration: typeof test = process.env.TEST_DATABASE_URL ? test : (test as unknown as { skip: typeof test }).skip;

integration('delta refresh merges updates, nested changes and inserts; a hard delete falls back to full hydration', async () => {
  const suffix = randomUUID();
  const companyId = `delta-${suffix}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const user = await prisma.user.create({
    data: { id: `${companyId}-user`, name: 'Delta User', email: `${companyId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId },
  });
  const location = await prisma.location.create({ data: { code: `DL-${suffix.slice(0, 8)}`, name: 'Before Rename', type: 'store', companyId } });
  const spareLocation = await prisma.location.create({ data: { code: `DX-${suffix.slice(0, 8)}`, name: 'Soon Deleted', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `DI-${suffix.slice(0, 8)}`, name: 'Delta Item', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `DLOT-${suffix.slice(0, 6)}`, expiryDate: new Date('2027-01-01T00:00:00.000Z') } });
  const transfer = await prisma.transfer.create({
    data: {
      sourceLocationId: location.id,
      destinationLocationId: location.id,
      requestedById: user.id,
      status: 'REQUESTED',
      companyId,
      lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 4, receivedQty: 0 }] },
    },
    include: { lines: true },
  });

  try {
    await hydrateRepositoryFromDatabase();
    assert.equal(deltaRefreshStats().mode, 'full');
    assert.equal(snapshotLocations.find((row) => row.id === location.id)?.name, 'Before Rename');

    // Writes another replica (or a direct DB change) would make: rename, nested lot expiry,
    // nested transfer-line progress, one brand-new item, transfer status.
    await prisma.location.update({ where: { id: location.id }, data: { name: 'After Rename' } });
    await prisma.lot.update({ where: { id: lot.id }, data: { expiryDate: new Date('2028-06-15T00:00:00.000Z') } });
    await prisma.transferLine.update({ where: { id: transfer.lines[0].id }, data: { receivedQty: 3 } });
    await prisma.transfer.update({ where: { id: transfer.id }, data: { status: 'IN_TRANSIT' } });
    const newItem = await prisma.item.create({ data: { code: `DN-${suffix.slice(0, 8)}`, name: 'Inserted Later', companyId } });

    await refreshRepositoryDeltaFromDatabase();
    const stats = deltaRefreshStats();
    assert.equal(stats.mode, 'delta', 'a tick with only changed rows must not fall back to a full hydration');
    assert.ok(stats.rowsLoaded < 50, `delta loaded ${stats.rowsLoaded} rows, not the whole database`);

    assert.equal(snapshotLocations.find((row) => row.id === location.id)?.name, 'After Rename');
    const snapshotItem = snapshotItems.find((row) => row.id === item.id);
    assert.equal(snapshotItem?.lots.find((row) => row.id === lot.id)?.expiryDate, '2028-06-15T00:00:00.000Z', 'a lot-only change reloads its parent item');
    const snapshotTransfer = snapshotTransfers.find((row) => row.id === transfer.id);
    assert.equal(snapshotTransfer?.status, 'IN_TRANSIT');
    assert.equal(snapshotTransfer?.lines[0].receivedQty, 3, 'a transfer-line-only change reloads its parent transfer');
    assert.ok(snapshotItems.some((row) => row.id === newItem.id), 'an inserted row arrives through the delta path');

    // A hard delete is invisible to updatedAt watermarks: the row-count check must fall back.
    await prisma.location.delete({ where: { id: spareLocation.id } });
    await refreshRepositoryDeltaFromDatabase();
    assert.equal(deltaRefreshStats().mode, 'full');
    assert.ok(!snapshotLocations.some((row) => row.id === spareLocation.id), 'the deleted location is gone after the fallback');
  } finally {
    await prisma.transferLine.deleteMany({ where: { transferId: transfer.id } });
    await prisma.transfer.deleteMany({ where: { id: transfer.id } });
    await prisma.lot.deleteMany({ where: { itemId: item.id } });
    await prisma.item.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.location.deleteMany({ where: { companyId } });
    await prisma.companyProfile.deleteMany({ where: { id: companyId } });
  }
});
