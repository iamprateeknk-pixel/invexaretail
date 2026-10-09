import test from 'node:test';
import assert from 'node:assert/strict';
import { tableOf } from './control-plane.js';

test('the table parameter accepts every table key, in any letter case, and defaults to stock', () => {
  assert.equal(tableOf(undefined), 'stock');
  assert.equal(tableOf('stock'), 'stock');
  assert.equal(tableOf('lots'), 'lots');
  assert.equal(tableOf('itemLots'), 'itemLots');
  assert.equal(tableOf('ITEMLOTS'), 'itemLots');
  assert.equal(tableOf('Lots'), 'lots');
});

test('an unknown table is refused with a stable error code', () => {
  for (const bad of ['orders', '', 'item_lots', '../stock']) {
    assert.throws(() => tableOf(bad), (error: { code?: string }) => error.code === 'INVALID_TABLE', bad);
  }
});
