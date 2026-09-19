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

test('the same platform order delivered twice reserves once (idempotent on platform + external id)', async () => {
  const input = { channel: 'FLIPKART', externalReference: ' FK-1001 ', createdById: 'connector', allowSplit: true, lines: [{ itemId: 'item-1001', quantity: 1 }] };
  const before = listMemoryOrders().length;
  const first = await createOrderWithReservation(input);
  assert.equal(first.duplicate, undefined);
  const again = await createOrderWithReservation({ ...input, externalReference: 'FK-1001' });
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  assert.equal(listMemoryOrders().length, before + 1);

  // Two deliveries arriving together still make one order.
  const [a, b] = await Promise.all([
    createOrderWithReservation({ ...input, externalReference: 'FK-2002' }),
    createOrderWithReservation({ ...input, externalReference: 'FK-2002' }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal([a, b].filter((order) => order.duplicate).length, 1);
  assert.equal(listMemoryOrders().length, before + 2);

  // The same number on another platform is a different order; no reference never dedupes.
  const other = await createOrderWithReservation({ ...input, channel: 'AMAZON', externalReference: 'FK-1001' });
  assert.notEqual(other.id, first.id);
  const x = await createOrderWithReservation({ ...input, externalReference: null });
  const y = await createOrderWithReservation({ ...input, externalReference: null });
  assert.notEqual(x.id, y.id);
});
