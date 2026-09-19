import test from 'node:test';
import assert from 'node:assert/strict';
import { canOrderFrom, categoriesToList, parseSupplierFields, presentSupplier } from './supplier-master.js';

test('a supplier needs a name and valid terms; only the fields given are returned on update', () => {
  assert.throws(() => parseSupplierFields({}, true), /at least 2 characters/);
  assert.throws(() => parseSupplierFields({ name: 'A' }, false), /at least 2 characters/);
  assert.deepEqual(parseSupplierFields({ leadTimeDays: 5 }, false), { leadTimeDays: 5 });
  assert.deepEqual(parseSupplierFields({ name: ' Fresh Foods ', moq: '12', paymentTerms: 'Net 30', leadTimeDays: '4' }, true), { name: 'Fresh Foods', moq: 12, paymentTerms: 'Net 30', leadTimeDays: 4 });
  assert.deepEqual(parseSupplierFields({ moq: null, contactName: '' }, false), { moq: null, contactName: null });
});

test('bad lead time, MOQ, email or status are refused', () => {
  assert.throws(() => parseSupplierFields({ leadTimeDays: 2.5 }, false), /whole number/);
  assert.throws(() => parseSupplierFields({ leadTimeDays: 400 }, false), /between 0 and 365/);
  assert.throws(() => parseSupplierFields({ moq: -1 }, false), /zero or more/);
  assert.throws(() => parseSupplierFields({ email: 'nope' }, false), /valid supplier email/);
  assert.throws(() => parseSupplierFields({ status: 'GONE' }, false), /ACTIVE, INACTIVE or BLOCKED/);
});

test('categories are stored once each and presented as a list; a blocked supplier cannot be ordered from', () => {
  const fields = parseSupplierFields({ categories: 'Dairy, Grocery,\nDairy,  ' }, false);
  assert.equal(fields.categories, 'Dairy\nGrocery');
  assert.deepEqual(categoriesToList(fields.categories), ['Dairy', 'Grocery']);
  assert.deepEqual(presentSupplier({ id: 's', categories: 'A\nB' }).categories, ['A', 'B']);
  assert.deepEqual(presentSupplier({ id: 's', categories: null }).categories, []);
  assert.deepEqual(parseSupplierFields({ categories: [' A ', 'B'] }, false), { categories: 'A\nB' });
  assert.equal(canOrderFrom('ACTIVE'), true);
  assert.equal(canOrderFrom(undefined), true);
  assert.equal(canOrderFrom('BLOCKED'), false);
});
