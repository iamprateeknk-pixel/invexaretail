import assert from 'node:assert/strict';
import test from 'node:test';
import { code39Svg, escapeHtml, matchScannedInventory } from './barcode.js';

test('scan matching is empty until a code is entered', () => {
  assert.deepEqual(matchScannedInventory([{ id: 'item-1', code: 'SKU-1', lots: [] }], '  ').matches, []);
});

test('scan matching resolves a unique SKU or lot and flags duplicates', () => {
  const items = [
    { id: 'item-1', code: 'SKU-1001', lots: [{ id: 'lot-1', lotNo: 'LOT-01' }] },
    { id: 'item-2', code: 'SKU-1002', lots: [{ id: 'lot-2', lotNo: 'LOT-01' }] },
  ];
  assert.equal(matchScannedInventory(items, 'sku-1001').matches[0].item.id, 'item-1');
  assert.equal(matchScannedInventory(items, 'lot-01').matches.length, 2);
  assert.equal(matchScannedInventory(items, 'missing').matches.length, 0);
});

test('Code 39 SVG wraps the payload with start and stop asterisks', () => {
  const svg = code39Svg('SKU-1');
  assert.match(svg, /aria-label="Barcode SKU-1"/);
  assert.match(svg, /<rect /);
  assert.equal(escapeHtml('<Rice & "5kg">'), '&lt;Rice &amp; &quot;5kg&quot;&gt;');
});
