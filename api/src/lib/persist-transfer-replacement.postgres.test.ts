// Wave 3 (P1-3): persistTransferReplacement used to release ALL of the old
// reservation and reserve ALL of the new one with read-decide-write inside
// the transaction (absolute values computed from a possibly stale read).
// It now moves each (item, lot, location) key by its exact delta through
// the same conditional UPDATE as reserveStockForTransfer, so concurrent
// edits serialise on the ledger row instead of overwriting each other.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { persistTransferReplacement } from './persistence.js';
import type { TransferRecord } from './repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeFixture(reservedQty: number, onHand = 100) {
  const companyId = `rep-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `rep-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'R', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const source = await prisma.location.create({ data: { id: `rep-loc-${randomUUID()}`, code: `rep-${randomUUID()}`, name: 'S', type: 'warehouse', companyId } });
  const dest = await prisma.location.create({ data: { id: `rep-loc-${randomUUID()}`, code: `rep-${randomUUID()}`, name: 'D', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `REP-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: source.id, onHand, reserved: reservedQty, companyId } });
  const transfer = await prisma.transfer.create({
    data: {
      sourceLocationId: source.id, destinationLocationId: dest.id, requestedById: userId,
      status: 'REQUESTED', companyId,
      lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: reservedQty }] },
    },
  });
  const record = (quantity: number): TransferRecord => ({
    id: transfer.id,
    sourceLocationId: source.id,
    destinationLocationId: dest.id,
    requestedBy: userId,
    role: 'ADMIN',
    status: 'REQUESTED',
    lines: [{ itemId: item.id, lotId: lot.id, quantity }],
    createdAt: new Date().toISOString(),
    companyId,
  });
  const reservedNow = async () => Number((await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: source.id } })).reserved);
  return { companyId, transferId: transfer.id, record, reservedNow };
}

integration('replacement moves the reservation by the exact delta, up and down', async () => {
  const fx = await makeFixture(10);
  await persistTransferReplacement(fx.record(10), fx.record(25), fx.companyId);
  assert.equal(await fx.reservedNow(), 25, 'increase reserves only the +15 delta (10 -> 25)');
  await persistTransferReplacement(fx.record(25), fx.record(5), fx.companyId);
  assert.equal(await fx.reservedNow(), 5, 'decrease releases only the -20 delta (25 -> 5)');
  const lines = await prisma.transferLine.findMany({ where: { transferId: fx.transferId } });
  assert.equal(lines.length, 1);
  assert.equal(Number(lines[0].requestedQty), 5, 'the stored lines match the replacement');
});

integration('replacement beyond availability rejects and leaves the reservation untouched', async () => {
  const fx = await makeFixture(10);
  await assert.rejects(persistTransferReplacement(fx.record(10), fx.record(105), fx.companyId), /units are available/);
  assert.equal(await fx.reservedNow(), 10, 'a rejected edit must not strand or consume reservation');
});

integration('two concurrent replacements competing for the same stock: exactly one wins', async () => {
  // One ledger row (onHand 100) shared by two transfers holding 10 each.
  const companyId = `rep-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const userId = `rep-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'R', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const source = await prisma.location.create({ data: { id: `rep-loc-${randomUUID()}`, code: `rep-${randomUUID()}`, name: 'S', type: 'warehouse', companyId } });
  const dest = await prisma.location.create({ data: { id: `rep-loc-${randomUUID()}`, code: `rep-${randomUUID()}`, name: 'D', type: 'store', companyId } });
  const item = await prisma.item.create({ data: { code: `REP-${randomUUID().slice(0, 8)}`, name: 'I', companyId } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: `L-${randomUUID().slice(0, 6)}` } });
  await prisma.stockLedger.create({ data: { itemId: item.id, lotId: lot.id, locationId: source.id, onHand: 100, reserved: 20, companyId } });
  const mkTransfer = async () => prisma.transfer.create({
    data: {
      sourceLocationId: source.id, destinationLocationId: dest.id, requestedById: userId,
      status: 'REQUESTED', companyId,
      lines: { create: [{ itemId: item.id, lotId: lot.id, requestedQty: 10 }] },
    },
  });
  const a = await mkTransfer();
  const b = await mkTransfer();
  const record = (t: { id: string }, quantity: number): TransferRecord => ({
    id: t.id, sourceLocationId: source.id, destinationLocationId: dest.id, requestedBy: userId,
    role: 'ADMIN', status: 'REQUESTED',
    lines: [{ itemId: item.id, lotId: lot.id, quantity }],
    createdAt: new Date().toISOString(), companyId,
  });
  // Both edits want +50 against (100 - 20) = 80 unreserved: only one fits.
  const results = await Promise.allSettled([
    persistTransferReplacement(record(a, 10), record(a, 60), companyId),
    persistTransferReplacement(record(b, 10), record(b, 60), companyId),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one competing edit succeeds');
  const ledger = await prisma.stockLedger.findFirstOrThrow({ where: { itemId: item.id, locationId: source.id } });
  assert.equal(Number(ledger.reserved), 70, 'the winner\u2019s delta landed exactly once (20 + 50)');
});
