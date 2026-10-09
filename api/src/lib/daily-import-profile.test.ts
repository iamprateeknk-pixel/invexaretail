import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDailyStockImport } from './daily-stock-sync.js';
import { defaultImportProfile, ImportProfileError, importTemplateCsv, normalizeImportProfile, profileKey } from './import-profile.js';

const csv = (rows: string[]) => Buffer.from(rows.join('\n'), 'utf8');
const options = { purchaseLocationName: 'H.O BASNI' };

test('default sales and purchase templates match the long-standing CSV templates', () => {
  assert.equal(
    importTemplateCsv(undefined, 'SALES'),
    ['S_No.,Branch Name,Bill Date,Bill Time,Bill No.,Item Code,Item Name,Lot No.,Unit,Total Qty,Row Source', '1,Main Store,11/09/2026,10:18 AM,DGR-1,SKU-1001,Rice 5kg,LOT-01,KG,1,ERP'].join('\n'),
  );
  assert.equal(
    importTemplateCsv(undefined, 'PURCHASE'),
    ['SNO.,Bill Date,Bill No.,Item Code,Item Name,Pack/Grade,Lot No.,Total Qty,Row Source', '1,11/09/2026,HOST-1,SKU-1001,Rice 5kg,KG,LOT-01,10,ERP'].join('\n'),
  );
});

test('profile storage keys keep opening stock on the bare company id', () => {
  assert.equal(profileKey('c1', 'OPENING_STOCK'), 'c1');
  assert.equal(profileKey('c1', 'SALES'), 'c1|SALES');
  assert.equal(profileKey('c1', 'PURCHASE'), 'c1|PURCHASE');
});

test('without a profile the sales parser behaves as before', async () => {
  const preview = await parseDailyStockImport(csv([
    'Branch Name,Bill Date,Bill No.,Item Name,Total Qty',
    'Main,11/09/2026,B1,Rice,2',
  ]), 's.csv', 'SALES', options);
  assert.equal(preview.validRows.length, 1);
  assert.equal(preview.validRows[0].movementType, 'SALE_OUT');
});

test('a renamed and reordered sales layout is read by its new names', async () => {
  const profile = normalizeImportProfile({
    fields: [
      { key: 'reference', label: 'Invoice Ref' },
      { key: 'billDate', label: 'Sold On' },
      { key: 'locationName', label: 'Outlet' },
      { key: 'itemName', label: 'Product' },
      { key: 'quantity', label: 'Units' },
    ].map((field) => ({ ...field, enabled: true })),
  }, 'SALES');
  assert.equal(importTemplateCsv(profile).split('\n')[0], 'Invoice Ref,Sold On,Outlet,Product,Units');
  const preview = await parseDailyStockImport(csv([
    'Invoice Ref,Sold On,Outlet,Product,Units',
    'B9,11/09/2026,Main,Rice,3',
  ]), 's.csv', 'SALES', options, profile);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.validRows[0].reference, 'B9');
  assert.equal(preview.validRows[0].quantity, 3);
});

test('required optional columns: missing column fails the file, blank cell fails only that row, default fills blanks', async () => {
  const required = normalizeImportProfile({ fields: defaultImportProfile('PURCHASE').fields.map((f) => (f.key === 'lotNo' ? { ...f, required: true } : f)) }, 'PURCHASE');
  await assert.rejects(
    parseDailyStockImport(csv(['Bill Date,Bill No.,Item Name,Total Qty', '11/09/2026,G1,Rice,5']), 'p.csv', 'PURCHASE', options, required),
    /Lot No\./,
  );
  const preview = await parseDailyStockImport(csv([
    'Bill Date,Bill No.,Item Name,Lot No.,Total Qty',
    '11/09/2026,G1,Rice,,5',
    '11/09/2026,G2,Dal,L2,4',
  ]), 'p.csv', 'PURCHASE', options, required);
  assert.equal(preview.validRows.length, 1);
  assert.match(preview.errors[0].message, /Lot No\. is required/);

  const withDefault = normalizeImportProfile({ fields: defaultImportProfile('PURCHASE').fields.map((f) => (f.key === 'lotNo' ? { ...f, required: true, defaultValue: 'LOT-DEFAULT' } : f)) }, 'PURCHASE');
  const filled = await parseDailyStockImport(csv(['Bill Date,Bill No.,Item Name,Lot No.,Total Qty', '11/09/2026,G1,Rice,,5']), 'p.csv', 'PURCHASE', options, withDefault);
  assert.equal(filled.validRows[0].lotNo, 'LOT-DEFAULT');
});

test('essential columns cannot be turned off and custom columns are stock-import only', () => {
  const sales = defaultImportProfile('SALES').fields;
  assert.throws(() => normalizeImportProfile({ fields: sales.map((f) => (f.key === 'reference' ? { ...f, enabled: false } : f)) }, 'SALES'), /Bill No\. cannot be turned off/);
  assert.throws(() => normalizeImportProfile({ fields: [...sales, { label: 'My Column' }] }, 'SALES'), /only be added to the stock import/);
  assert.throws(() => normalizeImportProfile({ fields: [...defaultImportProfile('PURCHASE').fields, { label: 'My Column' }] }, 'PURCHASE'), ImportProfileError);
  // Left-out columns come back: essential ones on, the rest off.
  const kept = normalizeImportProfile({ fields: [{ key: 'itemName', label: 'Item Name' }] }, 'PURCHASE');
  assert.equal(kept.fields.filter((f) => f.enabled).map((f) => f.key).sort().join(), 'billDate,itemName,quantity,reference');
});

test('the optional Rate column is only read after it is turned on in a saved profile', async () => {
  const file = csv(['Bill Date,Bill No.,Item Name,Total Qty,Rate', '11/09/2026,G1,Rice,5,12.5']);
  const noRate = await parseDailyStockImport(file, 'p.csv', 'PURCHASE', options, normalizeImportProfile({ fields: defaultImportProfile('PURCHASE').fields }, 'PURCHASE'));
  assert.notEqual(noRate.validRows[0].rate, 12.5, 'a switched-off Rate column is not read');
  const withRate = await parseDailyStockImport(file, 'p.csv', 'PURCHASE', options, normalizeImportProfile({ fields: defaultImportProfile('PURCHASE').fields.map((f) => (f.key === 'rate' ? { ...f, enabled: true } : f)) }, 'PURCHASE'));
  assert.equal(withRate.validRows[0].rate, 12.5);
});
