import test from 'node:test';
import assert from 'node:assert/strict';
import { expandBundleLines, type BundleDefinitions } from './bundle-expansion.js';

const kit: BundleDefinitions = new Map([['kit', [{ itemId: 'rice', quantity: 2 }, { itemId: 'dal', quantity: 3 }]]]);

test('a bundle line becomes component lines scaled by the ordered quantity', () => {
  assert.deepEqual(expandBundleLines([{ itemId: 'kit', quantity: 4 }], kit), [
    { itemId: 'rice', quantity: 8 },
    { itemId: 'dal', quantity: 12 },
  ]);
});

test('non-bundle lines pass through untouched and order is preserved', () => {
  assert.deepEqual(expandBundleLines([{ itemId: 'salt', quantity: 1 }, { itemId: 'kit', quantity: 1 }], kit), [
    { itemId: 'salt', quantity: 1 },
    { itemId: 'rice', quantity: 2 },
    { itemId: 'dal', quantity: 3 },
  ]);
});

test('a component also sold on its own is merged into one line', () => {
  assert.deepEqual(expandBundleLines([{ itemId: 'kit', quantity: 1 }, { itemId: 'rice', quantity: 5 }], kit), [
    { itemId: 'rice', quantity: 7 },
    { itemId: 'dal', quantity: 3 },
  ]);
});

test('two bundles sharing a component add its quantity', () => {
  const both: BundleDefinitions = new Map([...kit, ['kit2', [{ itemId: 'rice', quantity: 1 }]]]);
  const lines = expandBundleLines([{ itemId: 'kit', quantity: 1 }, { itemId: 'kit2', quantity: 3 }], both);
  assert.equal(lines.find((line) => line.itemId === 'rice')?.quantity, 5);
  assert.equal(lines.length, 2);
});

test('the stricter shelf-life requirement is carried to the components and wins on merge', () => {
  const lines = expandBundleLines([{ itemId: 'kit', quantity: 1, minRslPercent: 40 }, { itemId: 'rice', quantity: 1, minRslPercent: 60 }], kit);
  assert.equal(lines.find((line) => line.itemId === 'rice')?.minRslPercent, 60);
  assert.equal(lines.find((line) => line.itemId === 'dal')?.minRslPercent, 40);
});

test('fractional component quantities scale exactly enough to allocate', () => {
  const loose: BundleDefinitions = new Map([['mix', [{ itemId: 'flour', quantity: 0.5 }]]]);
  assert.deepEqual(expandBundleLines([{ itemId: 'mix', quantity: 3 }], loose), [{ itemId: 'flour', quantity: 1.5 }]);
});

test('with no bundle definitions the lines are returned as plain merged lines', () => {
  assert.deepEqual(expandBundleLines([{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 2 }], new Map()), [{ itemId: 'a', quantity: 3 }]);
});
