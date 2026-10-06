import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleAvailability, validateBundleDefinition } from './bundle-availability.js';

test('buildable is limited by the scarcest component', () => {
  const stock = new Map([['a', 10], ['b', 7]]);
  const result = bundleAvailability([{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 3 }], stock);
  assert.deepEqual(result, { buildable: 2, limitingItemId: 'b' });
});

test('a missing or negative component means none can be built', () => {
  assert.equal(bundleAvailability([{ itemId: 'a', quantity: 1 }, { itemId: 'b', quantity: 1 }], new Map([['a', 5]])).buildable, 0);
  assert.equal(bundleAvailability([{ itemId: 'a', quantity: 1 }], new Map([['a', -4]])).buildable, 0);
});

test('fractional components round down to whole bundles', () => {
  assert.equal(bundleAvailability([{ itemId: 'a', quantity: 0.5 }], new Map([['a', 3.2]])).buildable, 6);
});

test('an empty bundle has nothing buildable', () => {
  assert.deepEqual(bundleAvailability([], new Map()), { buildable: 0, limitingItemId: null });
});

test('definition validation rejects empty, self, duplicate, bad quantity and nested bundles', () => {
  assert.equal(validateBundleDefinition('x', [])?.code, 'EMPTY');
  assert.equal(validateBundleDefinition('x', [{ itemId: 'x', quantity: 1 }])?.code, 'SELF_REFERENCE');
  assert.equal(validateBundleDefinition('x', [{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 2 }])?.code, 'DUPLICATE_COMPONENT');
  assert.equal(validateBundleDefinition('x', [{ itemId: 'a', quantity: 0 }])?.code, 'INVALID_QUANTITY');
  assert.equal(validateBundleDefinition('x', [{ itemId: 'a', quantity: 1 }], new Set(['a']))?.code, 'NESTED_BUNDLE');
  assert.equal(validateBundleDefinition('x', [{ itemId: 'a', quantity: 1 }]), null);
});
