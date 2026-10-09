import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultImportProfile, ImportProfileError, normalizeImportProfile } from './import-profile.js';
import { parseStockImport } from './stock-import.js';

const csv = (rows: string[]) => Buffer.from(rows.join('\n'), 'utf8');

function profile(extraFields: unknown[], quantityFormula?: string) {
  const base = defaultImportProfile().fields.map((field) => (field.key === 'quantity' && quantityFormula ? { ...field, formula: quantityFormula } : field));
  return normalizeImportProfile({ fields: [...base, ...extraFields] });
}

const cartons = { label: 'Cartons', type: 'number' };
const pack = { label: 'Pack Qty', type: 'number' };

test('closing stock can be calculated from other number columns, and the column need not be in the file', async () => {
  const p = profile([cartons, pack], 'custom_cartons * custom_pack_qty');
  assert.equal(p.fields.find((f) => f.key === 'quantity')?.formula, 'custom_cartons * custom_pack_qty');
  const preview = await parseStockImport(csv([
    'BRANCH NAME,ITEM CODE,ITEM NAME,LOT CODE,Cartons,Pack Qty',
    'Main,A1,Rice,L1,3,12',
    'Main,A2,Dal,L1,2,10',
  ]), 's.csv', p);
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.validRows.map((row) => row.quantity), [36, 20]);
  assert.equal(preview.format, 'invexa-expiry-stock');
});

test('the formula result replaces a quantity column that is also in the file', async () => {
  const p = profile([cartons, pack], 'custom_cartons * custom_pack_qty');
  const preview = await parseStockImport(csv([
    'BRANCH NAME,ITEM NAME,LOT CODE,CLOSING STOCK,Cartons,Pack Qty',
    'Main,Rice,L1,999,2,5',
  ]), 's.csv', p);
  assert.equal(preview.validRows[0].quantity, 10);
});

test('a row with a missing input fails alone, in plain words; a division by zero too', async () => {
  const p = profile([cartons, pack], 'custom_cartons * custom_pack_qty');
  const preview = await parseStockImport(csv([
    'BRANCH NAME,ITEM NAME,LOT CODE,Cartons,Pack Qty',
    'Main,Rice,L1,,12',
    'Main,Dal,L1,2,10',
  ]), 's.csv', p);
  assert.equal(preview.validRows.length, 1);
  assert.match(preview.errors[0].message, /Could not calculate CLOSING STOCK: Cartons is empty or not a number/);

  const ratio = profile([cartons, pack], 'custom_cartons / custom_pack_qty');
  const zero = await parseStockImport(csv(['BRANCH NAME,ITEM NAME,LOT CODE,Cartons,Pack Qty', 'Main,Rice,L1,2,0']), 's.csv', ratio);
  assert.match(zero.errors[0].message, /Division by zero/);
});

test('a calculated custom column is saved in the row extras', async () => {
  const p = normalizeImportProfile({
    fields: [...defaultImportProfile().fields, cartons, pack, { label: 'Total Pieces', type: 'number', formula: 'custom_cartons * custom_pack_qty' }],
  });
  const preview = await parseStockImport(csv(['BRANCH NAME,ITEM NAME,LOT CODE,CLOSING STOCK,Cartons,Pack Qty', 'Main,Rice,L1,5,3,4']), 's.csv', p);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.validRows[0].extra?.custom_total_pieces, 12);
});

test('the profile refuses formulas that cannot work, with plain messages', () => {
  const fields = defaultImportProfile().fields;
  const withFormula = (formula: string, extra: unknown[] = [cartons]) => () => normalizeImportProfile({
    fields: [...fields.map((f) => (f.key === 'quantity' ? { ...f, formula } : f)), ...extra],
  });
  assert.throws(withFormula('nonsense * 2'), (e: Error) => e instanceof ImportProfileError && /Unknown field "nonsense"/.test(e.message) && /Columns you can use: .*Cartons/.test(e.message));
  assert.throws(withFormula('custom_cartons +'), ImportProfileError);
  assert.throws(withFormula('quantity * 2'), /Unknown field "quantity"/);
  assert.throws(() => normalizeImportProfile({ fields: fields.map((f) => (f.key === 'category' ? { ...f, formula: '1' } : f)) }), /not a number column/);
  assert.throws(() => normalizeImportProfile({ fields: defaultImportProfile('SALES').fields.map((f) => (f.key === 'quantity' ? { ...f, formula: '1' } : f)) }, 'SALES'), /only available for the stock import/);
  // No chains: a calculated column cannot feed another calculated column.
  assert.throws(() => normalizeImportProfile({
    fields: [...fields.map((f) => (f.key === 'quantity' ? { ...f, formula: 'custom_cartons * 2' } : f)), cartons, { label: 'Twice', type: 'number', formula: 'quantity + 1' }],
  }), /Unknown field "quantity"/);
});

test('a disabled column keeps no formula, and files without any formula behave exactly as before', async () => {
  const off = normalizeImportProfile({ fields: defaultImportProfile().fields.map((f) => (f.key === 'quantity' ? { ...f, enabled: false, formula: 'custom_x' } : f)) });
  assert.equal(off.fields.find((f) => f.key === 'quantity')?.formula, undefined);
  const plain = await parseStockImport(csv(['BRANCH NAME,ITEM NAME,LOT CODE,CLOSING STOCK', 'Main,Rice,L1,7']), 's.csv', defaultImportProfile());
  assert.equal(plain.validRows[0].quantity, 7);
});
