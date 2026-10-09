import test from 'node:test';
import assert from 'node:assert/strict';
import { checkImportFormula, formulaInputsFor } from './ImportColumnsEditor.jsx';

const fields = [
  { key: 'quantity', label: 'CLOSING STOCK', type: 'number', enabled: true },
  { key: 'custom_cartons', label: 'Cartons', type: 'number', enabled: true, custom: true },
  { key: 'custom_pack_qty', label: 'Pack Qty', type: 'number', enabled: true, custom: true },
  { key: 'custom_rack', label: 'Rack', type: 'text', enabled: true, custom: true },
  { key: 'saleValue', label: 'SALE VALUE', type: 'number', enabled: false },
  { key: 'custom_total', label: 'Total', type: 'number', enabled: true, formula: 'custom_cartons * 2' },
];

test('formula inputs are the other enabled number columns read from the file', () => {
  assert.deepEqual(formulaInputsFor(fields, fields[0]).map((f) => f.key), ['custom_cartons', 'custom_pack_qty']);
  assert.deepEqual(formulaInputsFor(fields, fields[1]).map((f) => f.key), ['quantity', 'custom_pack_qty']);
});

test('the live check evaluates with 10 in every column and explains problems in plain words', () => {
  const inputs = formulaInputsFor(fields, fields[0]);
  assert.deepEqual(checkImportFormula('custom_cartons * custom_pack_qty', inputs), { ok: true, value: 100 });
  const unknown = checkImportFormula('stock * 2', inputs);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown field "stock"/);
  assert.doesNotMatch(unknown.error, /You can use/);
  assert.equal(checkImportFormula('custom_cartons +', inputs).ok, false);
});
