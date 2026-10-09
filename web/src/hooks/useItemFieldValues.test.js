import test from 'node:test';
import assert from 'node:assert/strict';
import { itemFieldCell, usesItemFields } from './useItemFieldValues.js';

test('usesItemFields is true only when a published column shows an item field', () => {
  assert.equal(usesItemFields([{ key: 'physical', source: 'core' }]), false);
  assert.equal(usesItemFields([{ key: 'field_rack', source: 'itemField', itemField: 'Shelf Rack' }]), true);
  assert.equal(usesItemFields([{ key: 'field_x', source: 'itemField' }]), false);
  assert.equal(usesItemFields(undefined), false);
});

test('itemFieldCell reads the item value or shows a dash', () => {
  const values = { 'item-1': { 'Shelf Rack': 'R-7' } };
  assert.equal(itemFieldCell(values, 'item-1', 'Shelf Rack'), 'R-7');
  assert.equal(itemFieldCell(values, 'item-1', 'MRP'), '—');
  assert.equal(itemFieldCell(values, 'item-2', 'Shelf Rack'), '—');
  assert.equal(itemFieldCell(undefined, 'item-1', 'Shelf Rack'), '—');
});
