import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBundle } from './useBundle.js';

test('an empty, missing or malformed answer becomes "not a bundle" instead of crashing the screen', () => {
  for (const raw of [{}, null, undefined, 'oops', 42, [], { components: 'x' }, { isBundle: true }]) {
    const bundle = normalizeBundle(raw);
    assert.equal(bundle.isBundle, false);
    assert.deepEqual(bundle.components, []);
    assert.equal(bundle.buildable, 0);
    assert.equal(bundle.limitingItemId, null);
  }
});

test('a real bundle keeps its components, buildable count and limiting item', () => {
  const bundle = normalizeBundle({ isBundle: true, buildable: 4, limitingItemId: 'i2', components: [{ itemId: 'i1', quantity: 2 }, { itemId: 'i2', quantity: 1 }, null] });
  assert.equal(bundle.isBundle, true);
  assert.equal(bundle.components.length, 2, 'junk entries are dropped');
  assert.equal(bundle.buildable, 4);
  assert.equal(bundle.limitingItemId, 'i2');
});
