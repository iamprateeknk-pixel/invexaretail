import assert from 'node:assert/strict';
import test from 'node:test';
import { buildItemLabelDocument, buildTransferSlipDocument } from './print-labels.js';

test('item labels print the lot barcode when a lot is selected', () => {
  const label = buildItemLabelDocument({
    source: { id: 'item-1', code: 'SKU-1001', name: 'Rice 5kg' },
    item: { itemId: 'item-1', itemName: 'Rice 5kg' },
    lot: { lotNo: 'LOT-01' },
    locationName: 'Main Store',
  });
  assert.equal(label.title, 'LOT-01');
  assert.match(label.html, /Rice 5kg/);
  assert.match(label.html, /LOT LOT-01/);
  assert.match(label.html, /Barcode LOT-01/);
});

test('transfer slips keep thermal copy without leaking markup', () => {
  const slip = buildTransferSlipDocument({
    id: 'tr-1',
    status: 'PICKED',
    fromName: 'Warehouse',
    toName: 'Main Store',
    cartonCount: 2,
    item: 'Rice <5kg>',
    qty: 8,
  }, '14/09/2026, 18:00:00');
  assert.equal(slip.title, 'Transfer tr-1');
  assert.match(slip.html, /STOCK TRANSFER/);
  assert.match(slip.html, /Rice &lt;5kg&gt;/);
  assert.match(slip.html, /14\/09\/2026, 18:00:00/);
});
