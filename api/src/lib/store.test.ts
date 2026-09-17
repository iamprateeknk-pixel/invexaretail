import test from 'node:test';
import assert from 'node:assert/strict';

import { createInventoryItem, createTransferRequest, submitStockCount } from './store.js';

test('createInventoryItem creates an item and its lot record', () => {
  const item = createInventoryItem({ code: 'SKU-100', name: 'Rice 5kg', category: 'Staples', unit: 'bag' });

  assert.equal(item.code, 'SKU-100');
  assert.equal(item.lots.length, 1);
  assert.equal(item.lots[0].lotNo, 'LOT-DEFAULT');
});

test('submitStockCount records the physical quantity without hidden system data', () => {
  const item = createInventoryItem({ code: 'SKU-200', name: 'Milk', category: 'Dairy', unit: 'pack' });
  const count = submitStockCount({
    itemId: item.id,
    lotId: item.lots[0].id,
    locationId: 'loc-1',
    physicalQuantity: 18,
    mode: 'scan',
    submittedBy: 'store-user-1',
    role: 'STORE_USER',
  });

  assert.equal(count.physicalQuantity, 18);
  assert.equal(count.role, 'STORE_USER');
});

test('createTransferRequest requires admin and validates positive quantities', () => {
  const item = createInventoryItem({ code: 'SKU-300', name: 'Soap', category: 'Household', unit: 'box' });
  const transfer = createTransferRequest({
    sourceLocationId: 'loc-1',
    destinationLocationId: 'wh-1',
    requestedBy: 'admin-1',
    role: 'ADMIN',
    lines: [{ itemId: item.id, lotId: item.lots[0].id, quantity: 5 }],
  });

  assert.equal(transfer.status, 'REQUESTED');
  assert.equal(transfer.lines[0].quantity, 5);
});
