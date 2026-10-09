// The catalogue version (GET /items/version) must change whenever anything the full catalogue shows changes, and
// must not change when nothing did or when only another company changed. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { getCatalogueVersion } from './item-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

async function makeCompany() {
  const id = `cat-ver-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  const item = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Versioned', companyId: id } });
  const lot = await prisma.lot.create({ data: { itemId: item.id, lotNo: 'L1' } });
  return { id, itemId: item.id, lotId: lot.id };
}

integration('is stable when nothing changed and moves for an item edit, a lot edit, a new lot, a new item and a delete', async () => {
  const c = await makeCompany();
  const ctx = ctxFor(c.id);
  const v0 = await getCatalogueVersion(ctx);
  assert.ok(v0);
  assert.equal(await getCatalogueVersion(ctx), v0, 'unchanged catalogue, unchanged version');

  await tick(); await prisma.item.update({ where: { id: c.itemId }, data: { name: 'Renamed' } });
  const v1 = await getCatalogueVersion(ctx); assert.notEqual(v1, v0, 'item edit');

  await tick(); await prisma.lot.update({ where: { id: c.lotId }, data: { status: 'QUARANTINE' } });
  const v2 = await getCatalogueVersion(ctx); assert.notEqual(v2, v1, 'lot edit');

  await tick(); const lot2 = await prisma.lot.create({ data: { itemId: c.itemId, lotNo: 'L2' } });
  const v3 = await getCatalogueVersion(ctx); assert.notEqual(v3, v2, 'new lot');

  await tick(); const item2 = await prisma.item.create({ data: { code: `I-${randomUUID().slice(0, 8)}`, name: 'Second', companyId: c.id } });
  const v4 = await getCatalogueVersion(ctx); assert.notEqual(v4, v3, 'new item');

  await prisma.item.delete({ where: { id: item2.id } });
  const v5 = await getCatalogueVersion(ctx); assert.notEqual(v5, v4, 'deleted item (count drops)');

  await prisma.lot.delete({ where: { id: lot2.id } });
  assert.notEqual(await getCatalogueVersion(ctx), v5, 'deleted lot (count drops)');
});

integration("another company's changes never move this company's version", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const before = await getCatalogueVersion(ctxFor(a.id));
  await tick();
  await prisma.item.update({ where: { id: b.itemId }, data: { name: 'Other company edit' } });
  await prisma.lot.update({ where: { id: b.lotId }, data: { status: 'BLOCKED' } });
  assert.equal(await getCatalogueVersion(ctxFor(a.id)), before);
});

test('memory mode reports no version, so clients refetch exactly as before', async () => {
  if (process.env.TEST_DATABASE_URL) return; // database mode is covered above
  assert.equal(await getCatalogueVersion(ctxFor('default-company')), null);
});
