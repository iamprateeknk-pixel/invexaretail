// Real-Postgres proof that imported custom-column values land on the right items, never cross
// companies, never overwrite with blanks, and reuse (not duplicate) field definitions.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { loadCustomFieldValues, saveImportedCustomValues } from './import-custom-values.js';
import { defaultImportProfile, normalizeImportProfile } from './import-profile.js';
import { persistOpeningStockImport } from './persistence.js';
import { controlPlane } from './saas/control-plane.js';
import { parseStockImport } from './stock-import.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function makeCompany(code: string) {
  const companyId = `cust-values-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
  const item = await prisma.item.create({ data: { id: `item-${randomUUID()}`, code, name: `Item ${code}`, unit: 'ea', companyId } });
  controlPlane.importProfiles.set(companyId, normalizeImportProfile({
    fields: [...defaultImportProfile().fields, { label: 'Shelf Rack', type: 'text' }, { label: 'MRP', type: 'number' }],
  }));
  return { companyId, item };
}

async function valuesOf(itemId: string) {
  const rows = await prisma.customFieldValue.findMany({ where: { itemId }, include: { field: true } });
  return Object.fromEntries(rows.map((row) => [row.field.name, row.value]));
}

integration('values are saved on the matching item, reuse definitions, and blanks never overwrite', async () => {
  const { companyId, item } = await makeCompany('SKU-A');

  const first = await saveImportedCustomValues(companyId, [
    { code: 'SKU-A', extra: { custom_shelf_rack: 'R-7', custom_mrp: 99.5 } },
    { code: 'NO-SUCH-ITEM', extra: { custom_mrp: 1 } },
  ]);
  assert.deepEqual(first, { fields: 2, values: 2, unmatchedItems: 1 });
  assert.deepEqual(await valuesOf(item.id), { 'Shelf Rack': 'R-7', MRP: '99.5' });

  const second = await saveImportedCustomValues(companyId, [{ code: 'SKU-A', extra: { custom_shelf_rack: '', custom_mrp: 120 } }]);
  assert.equal(second.values, 1);
  assert.deepEqual(await valuesOf(item.id), { 'Shelf Rack': 'R-7', MRP: '120' }, 'blank rack kept, MRP updated');
  assert.equal(await prisma.customFieldDefinition.count({ where: { companyId } }), 2, 'definitions are reused, not duplicated');
  assert.equal(await prisma.customFieldValue.count({ where: { itemId: item.id } }), 2, 'one value row per item and field');
});

integration('another company with the same item code is never touched', async () => {
  const a = await makeCompany('SAME-CODE');
  const b = await makeCompany('SAME-CODE');
  await saveImportedCustomValues(a.companyId, [{ code: 'SAME-CODE', extra: { custom_mrp: 10 } }]);
  assert.deepEqual(await valuesOf(a.item.id), { MRP: '10' });
  assert.deepEqual(await valuesOf(b.item.id), {}, 'company B has the same code but must stay untouched');
  assert.equal(await prisma.customFieldDefinition.count({ where: { companyId: b.companyId } }), 0);
});

integration('a company with no custom columns configured writes nothing', async () => {
  const { companyId, item } = await makeCompany('SKU-Z');
  controlPlane.importProfiles.delete(companyId);
  const result = await saveImportedCustomValues(companyId, [{ code: 'SKU-Z', extra: { custom_mrp: 5 } }]);
  assert.deepEqual(result, { fields: 0, values: 0, unmatchedItems: 0 });
  assert.deepEqual(await valuesOf(item.id), {});
});

integration('an opening-stock file with custom columns saves them onto the imported items end to end', async () => {
  const { companyId } = await makeCompany('UNUSED');
  const userId = `cust-values-user-${randomUUID()}`;
  await prisma.user.create({ data: { id: userId, name: 'Custom values tester', email: `${userId}@test.invexa.local`, passwordHash: 'x', role: 'ADMIN', assignedLocations: '[]', companyId } });
  const file = Buffer.from([
    'BRANCH NAME,ITEM CODE,ITEM NAME,LOT CODE,CLOSING STOCK,Shelf Rack,MRP',
    'Main,E2E-1,Rice,L1,10,R-1,45.5',
    'Main,E2E-2,Dal,L1,5,,70',
  ].join('\n'));
  const profile = controlPlane.importProfiles.get(companyId)!;
  const preview = await parseStockImport(file, 'e2e.csv', profile);
  assert.deepEqual(preview.errors, []);

  const result = await persistOpeningStockImport(preview, 'e2e.csv', userId, { companyId });
  assert.equal(result.customValuesError, undefined);
  assert.deepEqual(result.customValues, { fields: 2, values: 3, unmatchedItems: 0 });

  const rice = await prisma.item.findFirstOrThrow({ where: { companyId, code: 'E2E-1' } });
  const dal = await prisma.item.findFirstOrThrow({ where: { companyId, code: 'E2E-2' } });
  assert.deepEqual(await valuesOf(rice.id), { 'Shelf Rack': 'R-1', MRP: '45.5' });
  assert.deepEqual(await valuesOf(dal.id), { MRP: '70' }, 'a blank cell stores nothing');
});

integration('loadCustomFieldValues returns only the calling company values, keyed by item id and field name', async () => {
  const a = await makeCompany('LOAD-1');
  const b = await makeCompany('LOAD-1');
  await saveImportedCustomValues(a.companyId, [{ code: 'LOAD-1', extra: { custom_shelf_rack: 'A-RACK', custom_mrp: 5 } }]);
  await saveImportedCustomValues(b.companyId, [{ code: 'LOAD-1', extra: { custom_shelf_rack: 'B-RACK' } }]);
  assert.deepEqual(await loadCustomFieldValues(a.companyId), { [a.item.id]: { 'Shelf Rack': 'A-RACK', MRP: '5' } });
  assert.deepEqual(await loadCustomFieldValues(b.companyId), { [b.item.id]: { 'Shelf Rack': 'B-RACK' } });
});
