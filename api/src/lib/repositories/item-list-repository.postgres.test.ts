// Database-first slice 6 (docs/db-first-reads-plan.md): the whole catalogue read from Postgres per company, through
// the same mapper snapshot hydration uses. Skipped unless TEST_DATABASE_URL is set (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hydrateRepositoryFromDatabase } from '../persistence.js';
import { items as snapshot } from '../repository.js';
import { listItemsForCompany } from './item-repository.js';
import type { TenantContext } from '../tenant-context.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const ctxFor = (companyId: string): TenantContext => ({ companyId, tenantId: 'tenant-invexa', userId: 'u', role: 'ADMIN' });

async function makeCompany() {
  const id = `item-list-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  return id;
}

async function makeRichItem(companyId: string, suffix: string) {
  const item = await prisma.item.create({
    data: {
      code: `I-${suffix}-${randomUUID().slice(0, 6)}`, name: `Item ${suffix}`, companyId, category: 'Dairy', subcategory: 'Milk', company: 'Acme',
      unit: 'KG', barcode: `890${randomUUID().slice(0, 8)}`, hsn: '0401', gstRate: 5, mrp: 99.5, leadTimeDays: 3, shelfLifeDays: 30,
      lotRequired: true, expiryRequired: true, decimalQuantity: true, countMethod: 'ITEM_WEIGHT', pickMethod: 'WEIGHT', allocationStrategy: 'FIFO',
      aliases: ['alias one', 'alias two'],
    },
  });
  await prisma.lot.create({ data: { itemId: item.id, lotNo: 'A1', expiryDate: new Date('2027-03-01T00:00:00Z'), attributes: { shelf: 'B2' } } });
  await prisma.lot.create({ data: { itemId: item.id, lotNo: 'A2', status: 'QUARANTINE' } });
  return item;
}

integration("returns only the caller's items with their lots, oldest first", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const first = await makeRichItem(a, 'one');
  const second = await makeRichItem(a, 'two');
  const foreign = await makeRichItem(b, 'other');

  const mine = await listItemsForCompany(ctxFor(a));
  assert.deepEqual(mine.map((row) => row.id), [first.id, second.id]);
  assert.equal(mine[0].lots.length, 2);
  assert.equal(mine[0].mrp, 99.5, 'Decimal mrp is a plain number');
  assert.ok(!mine.some((row) => row.id === foreign.id));
  assert.deepEqual((await listItemsForCompany(ctxFor(b))).map((row) => row.id), [foreign.id]);
});

integration('parity: equals the hydrated snapshot for the same company, field for field', async () => {
  const company = await makeCompany();
  const created = [await makeRichItem(company, 'p1'), await makeRichItem(company, 'p2')];
  // an item with every optional column left empty exercises the defaults
  created.push(await prisma.item.create({ data: { code: `I-bare-${randomUUID().slice(0, 6)}`, name: 'Bare item', companyId: company } }));

  await hydrateRepositoryFromDatabase();
  const fromDb = await listItemsForCompany(ctxFor(company));
  const ids = new Set(created.map((row) => row.id));
  const fromSnapshot = snapshot.filter((row) => ids.has(row.id));
  assert.equal(fromDb.length, 3);
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  const sortLots = (row: (typeof fromDb)[number]) => ({ ...row, lots: [...row.lots].sort((x, y) => x.lotNo.localeCompare(y.lotNo)) });
  assert.deepEqual([...fromDb].sort(byId).map(sortLots), [...fromSnapshot].sort(byId).map(sortLots));
});
