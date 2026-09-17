import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPickerTask, completePickerTask } from './picker.js';

test('picker task is scoped to assigned transfers and quantities', () => {
  const task = buildPickerTask({
    transferId: 'transfer-1',
    locationId: 'wh-1',
    lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 12 }],
    assignedPickerId: 'user-picker-1',
    role: 'WAREHOUSE_PICKER',
  });

  assert.equal(task.locationId, 'wh-1');
  assert.equal(task.lines[0].quantity, 12);
});

test('picker task completion validates quantity before close', () => {
  const updated = completePickerTask({
    transferId: 'transfer-1',
    pickerId: 'user-picker-1',
    role: 'WAREHOUSE_PICKER',
    pickedQty: 12,
  });

  assert.equal(updated.status, 'PICKED');
  assert.equal(updated.pickedQty, 12);
});
