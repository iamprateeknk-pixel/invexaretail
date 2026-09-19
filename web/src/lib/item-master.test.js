import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDeleteBlockers, formToPayload, itemStatusMeta, itemToForm, parseAliases } from './item-master.js';

test('an item becomes editable form state with sensible defaults', () => {
  const form = itemToForm({ code: 'SKU-1', name: 'Rice', gstRate: 5, aliases: ['RICE-5', 'Basmati'], lotRequired: false });
  assert.equal(form.gstRate, '5');
  assert.equal(form.aliases, 'RICE-5, Basmati');
  assert.equal(form.lotRequired, false);
  assert.equal(form.countMethod, 'LOT_SCAN');
  assert.equal(form.allocationStrategy, 'FEFO');
  assert.equal(form.barcode, '');
  assert.equal(itemToForm({ code: 'a', name: 'b' }).lotRequired, true);
});

test('aliases are split, trimmed and de-duplicated ignoring case', () => {
  assert.deepEqual(parseAliases('A, a ,B  C,\n D,,'), ['A', 'B C', 'D']);
  assert.deepEqual(parseAliases(''), []);
  assert.deepEqual(parseAliases(undefined), []);
});

test('the form is validated and cleared fields are sent as null so they really clear', () => {
  const bad = formToPayload({ ...itemToForm({ code: '', name: '' }), gstRate: '150', leadTimeDays: '1.5', hsn: 'ab-1' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 5);

  const good = formToPayload({ ...itemToForm({ code: ' SKU-1 ', name: 'Rice' }), mrp: '99.5', shelfLifeDays: '180', aliases: 'x, y', hsn: '' });
  assert.equal(good.ok, true);
  assert.equal(good.payload.code, 'SKU-1');
  assert.equal(good.payload.mrp, 99.5);
  assert.equal(good.payload.shelfLifeDays, 180);
  assert.equal(good.payload.hsn, null);
  assert.equal(good.payload.barcode, null);
  assert.equal(good.payload.gstRate, null);
  assert.deepEqual(good.payload.aliases, ['x', 'y']);
});

test('status labels and delete blockers read plainly', () => {
  assert.equal(itemStatusMeta('ARCHIVED').label, 'Archived');
  assert.equal(itemStatusMeta('INACTIVE').label, 'Inactive');
  assert.equal(itemStatusMeta(undefined).label, 'Active');
  assert.equal(describeDeleteBlockers([{ count: 2, label: 'stock on hand' }, { count: 1, label: 'stock counts' }]), '2 stock on hand, 1 stock counts');
  assert.equal(describeDeleteBlockers([]), '');
});
