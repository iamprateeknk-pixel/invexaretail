import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENING_STOCK_TEMPLATE, PURCHASE_IMPORT_TEMPLATE, SALES_IMPORT_TEMPLATE } from './import-templates.js';

test('import templates include the documented contract columns', () => {
  assert.match(SALES_IMPORT_TEMPLATE, /Branch Name/);
  assert.match(SALES_IMPORT_TEMPLATE, /Row Source/);
  assert.match(PURCHASE_IMPORT_TEMPLATE, /Bill No/);
  assert.match(OPENING_STOCK_TEMPLATE, /LOT CODE/);
  assert.match(OPENING_STOCK_TEMPLATE, /EXPIRY DATE/);
});
