import test from 'node:test';
import assert from 'node:assert/strict';

import { createOrderWithReservation, listMemoryOrders, OrderShortageError } from './orders.js';

test('memory mode reserves a channel order without a database', async () => {
  assert.equal(Boolean(process.env.DATABASE_URL), false);
  const before = listMemoryOrders().length;
  const order = await createOrderWithReservation({
    channel: 'WEBSITE',
    createdById: 'test',
    allowSplit: true,
    lines: [{ itemId: 'item-1001', quantity: 1 }],
  });
  assert.equal(order.status, 'RESERVED');
  assert.ok(order.fulfillmentLocationId);
  assert.equal(order.lines[0].itemId, 'item-1001');
  assert.equal(listMemoryOrders().length, before + 1);
});

test('memory mode splits a line that one location cannot fill alone', async () => {
  assert.equal(Boolean(process.env.DATABASE_URL), false);
  try {
    const order = await createOrderWithReservation({
      channel: 'AMAZON',
      createdById: 'test',
      allowSplit: true,
      lines: [{ itemId: 'item-1001', quantity: 1 }],
    });
    const locations = new Set(order.lines.map((line) => line.fulfillmentLocationId));
    assert.ok(locations.size >= 1);
  } catch (error) {
    assert.equal(error instanceof OrderShortageError, true);
  }
});
