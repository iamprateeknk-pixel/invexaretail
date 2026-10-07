// Decimal slice 6 on real Postgres: Item.mrp is NUMERIC(14,2) in the database (rounded half-up to 2dp)
// but item records and everything built on the repository carry a plain number, never a Decimal
// object or string. Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { findItemById, listItems, searchItems } from './item-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration('Item.mrp: 2dp NUMERIC in the database, a plain number from every repository read', async () => {
  const companyId = `mrp-co-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const withMrp = await prisma.item.create({ data: { id: `mrp-a-${randomUUID()}`, code: `MRP-A-${randomUUID()}`, name: 'With MRP', unit: 'ea', companyId, mrp: 12.345 } });
  const withoutMrp = await prisma.item.create({ data: { id: `mrp-b-${randomUUID()}`, code: `MRP-B-${randomUUID()}`, name: 'Without MRP', unit: 'ea', companyId } });
  const ctx: TenantContext = { companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' };

  assert.equal(Number((await prisma.item.findUniqueOrThrow({ where: { id: withMrp.id } })).mrp), 12.35, 'rounded half-up to 2dp');

  const found = await findItemById(ctx, withMrp.id);
  assert.equal(typeof found?.mrp, 'number');
  assert.equal(found?.mrp, 12.35);
  assert.equal((await findItemById(ctx, withoutMrp.id))?.mrp, undefined, 'a missing MRP stays absent, never 0 or NaN');

  const listed = await listItems(ctx);
  assert.equal(listed.find((item) => item.id === withMrp.id)?.mrp, 12.35);
  const searched = await searchItems(ctx, { search: 'With MRP' });
  assert.equal(typeof searched.items[0].mrp, 'number');
  assert.equal(JSON.parse(JSON.stringify(searched.items[0])).mrp, 12.35, 'serializes as a JSON number');
});
