import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultImportProfile, importTemplateCsv, ImportProfileError, normalizeImportProfile } from './import-profile.js';
import { parseStockImport } from './stock-import.js';

const csv = (text: string) => Buffer.from(text, 'utf8');

function profileWith(mutate: (fields: ReturnType<typeof defaultImportProfile>['fields']) => unknown[]) {
  return normalizeImportProfile({ fields: mutate(defaultImportProfile().fields) });
}

test('default profile keeps the long-standing template header order', () => {
  assert.equal(
    importTemplateCsv(undefined).split('\n')[0],
    'COMPANY NAME,BRANCH NAME,CATEGORY,SUB CATEGORY,ITEM CODE,ITEM NAME,PACK/SIZE,BATCH,LOT CODE,EXPIRY DATE,CLOSING STOCK',
  );
});

test('without a profile the parser behaves as before', async () => {
  const preview = await parseStockImport(csv('BRANCH NAME,ITEM NAME,LOT CODE,CLOSING STOCK\nMain,Rice,L1,5\n'), 'a.csv');
  assert.equal(preview.validRows.length, 1);
  assert.equal(preview.validRows[0].lotNo, 'L1');
  assert.equal(preview.validRows[0].quantity, 5);
});

test('a reordered, renamed column is read by its new name and the template follows the new order', async () => {
  const profile = profileWith((fields) => {
    const byKey = new Map(fields.map((field) => [field.key, field]));
    const order = ['lotNo', 'itemName', 'locationName', 'quantity'];
    const rest = fields.filter((field) => !order.includes(field.key)).map((field) => ({ ...field, enabled: false }));
    return [
      ...order.map((key) => ({ ...byKey.get(key), label: key === 'lotNo' ? 'Lot No Custom' : byKey.get(key)!.label })),
      ...rest,
    ];
  });
  assert.equal(importTemplateCsv(profile).split('\n')[0], 'Lot No Custom,ITEM NAME,BRANCH NAME,CLOSING STOCK');
  const preview = await parseStockImport(csv('Lot No Custom,ITEM NAME,BRANCH NAME,CLOSING STOCK\nL9,Rice,Main,7\n'), 'a.csv', profile);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.validRows[0].lotNo, 'L9');
});

test('a disabled built-in column is ignored even if the file has it', async () => {
  const profile = profileWith((fields) => fields.map((field) => (field.key === 'category' ? { ...field, enabled: false } : field)));
  const preview = await parseStockImport(csv('BRANCH NAME,ITEM NAME,CATEGORY,CLOSING STOCK\nMain,Rice,Staples,5\n'), 'a.csv', profile);
  assert.equal(preview.validRows[0].category, undefined);
});

test('required column missing from the file fails with a plain message; blank required cell fails that row only', async () => {
  const profile = profileWith((fields) => fields.map((field) => (field.key === 'lotNo' ? { ...field, required: true } : field)));
  await assert.rejects(parseStockImport(csv('BRANCH NAME,ITEM NAME,CLOSING STOCK\nMain,Rice,5\n'), 'a.csv', profile), /LOT CODE/);
  const preview = await parseStockImport(csv('BRANCH NAME,ITEM NAME,LOT CODE,CLOSING STOCK\nMain,Rice,,5\nMain,Dal,L2,3\n'), 'a.csv', profile);
  assert.equal(preview.validRows.length, 1);
  assert.match(preview.errors[0].message, /LOT CODE is required/);
});

test('custom columns are captured, typed and validated; defaults fill blanks', async () => {
  const profile = normalizeImportProfile({
    fields: [
      ...defaultImportProfile().fields,
      { key: '', label: 'Shelf Rack', type: 'text', defaultValue: 'UNASSIGNED' },
      { label: 'MRP', type: 'number', aliases: ['Max Retail Price'], required: true },
    ],
  });
  const custom = profile.fields.filter((field) => field.custom);
  assert.deepEqual(custom.map((field) => field.key), ['custom_shelf_rack', 'custom_mrp']);

  const preview = await parseStockImport(
    csv('BRANCH NAME,ITEM NAME,CLOSING STOCK,Max Retail Price\nMain,Rice,5,99.5\nMain,Dal,2,abc\n'),
    'a.csv',
    profile,
  );
  assert.deepEqual(preview.validRows[0].extra, { custom_shelf_rack: 'UNASSIGNED', custom_mrp: 99.5 });
  assert.match(preview.errors[0].message, /MRP "abc" must be a number/);
});

test('profile validation rejects unsafe edits with plain messages', () => {
  const fields = defaultImportProfile().fields;
  assert.throws(() => normalizeImportProfile({ fields: fields.map((f) => (f.key === 'itemName' ? { ...f, enabled: false } : f)) }), ImportProfileError);
  assert.throws(() => normalizeImportProfile({ fields: [...fields, { label: 'item name' }] }), /called/);
  assert.throws(() => normalizeImportProfile({ fields: [...fields, { label: '' }] }), /needs a name/);
  assert.throws(() => normalizeImportProfile({}), /required/);
  // Built-ins left out are re-added (turned off), never lost.
  const kept = normalizeImportProfile({ fields: fields.filter((f) => f.key === 'itemName') });
  assert.equal(kept.fields.length, defaultImportProfile().fields.length);
});
