import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_KIND_OPTIONS } from './ImportColumnsEditor.jsx';

test('the editor offers stock, sales and purchase imports, stock first', () => {
  assert.deepEqual(IMPORT_KIND_OPTIONS.map((option) => option.value), ['OPENING_STOCK', 'SALES', 'PURCHASE']);
});
