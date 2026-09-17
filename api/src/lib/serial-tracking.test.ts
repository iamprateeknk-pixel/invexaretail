import test from 'node:test';
import assert from 'node:assert/strict';
import { assertValidSerialTransition, buildRecallTrace, planSerialMovement, SerialTransitionError } from './serial-tracking.js';

test('a serial can be in only one state - legal transitions are allowed', () => {
  assert.doesNotThrow(() => assertValidSerialTransition('IN_STOCK', 'RESERVED'));
  assert.doesNotThrow(() => assertValidSerialTransition('RESERVED', 'SOLD'));
  assert.doesNotThrow(() => assertValidSerialTransition('SOLD', 'RETURNED'));
  assert.doesNotThrow(() => assertValidSerialTransition('RETURNED', 'IN_STOCK'));
});

test('rejects transitions that would let a serial skip an invariant state', () => {
  assert.throws(() => assertValidSerialTransition('SOLD', 'RESERVED'), SerialTransitionError);
  assert.throws(() => assertValidSerialTransition('LOST', 'SOLD'), SerialTransitionError);
  assert.throws(() => assertValidSerialTransition('DAMAGED', 'SOLD'), SerialTransitionError);
});

test('planSerialMovement shapes a movement row and rejects illegal transitions before anything is persisted', () => {
  const movement = planSerialMovement({
    currentStatus: 'IN_STOCK',
    toStatus: 'SOLD',
    movementType: 'SALE',
    fromLocationId: 'loc-1',
    reference: 'order-42',
    actorId: 'user-1',
  });
  assert.deepEqual(movement, {
    movementType: 'SALE',
    fromLocationId: 'loc-1',
    toLocationId: null,
    fromStatus: 'IN_STOCK',
    toStatus: 'SOLD',
    reference: 'order-42',
    actorId: 'user-1',
  });

  assert.throws(
    () => planSerialMovement({ currentStatus: 'LOST', toStatus: 'SOLD', movementType: 'SALE' }),
    SerialTransitionError,
  );
});

test('buildRecallTrace orders movements chronologically with a human-readable event per row', () => {
  const trace = buildRecallTrace([
    { id: 'm2', movementType: 'SALE', fromLocationId: 'loc-1', toLocationId: null, fromStatus: 'IN_STOCK', toStatus: 'SOLD', reference: 'order-42', actorId: 'user-1', createdAt: '2026-09-10T00:00:00.000Z' },
    { id: 'm1', movementType: 'RECEIVE', fromLocationId: null, toLocationId: 'loc-1', fromStatus: null, toStatus: 'IN_STOCK', reference: 'grn-1', actorId: 'user-2', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'm3', movementType: 'RETURN', fromLocationId: null, toLocationId: 'loc-1', fromStatus: 'SOLD', toStatus: 'RETURNED', reference: 'rma-9', actorId: 'user-1', createdAt: '2026-09-15T00:00:00.000Z' },
  ]);
  assert.equal(trace.length, 3);
  assert.deepEqual(trace.map((step) => step.event), ['Received from supplier', 'Sold', 'Returned']);
  assert.equal(trace[0].reference, 'grn-1');
  assert.ok(trace[0].at < trace[1].at && trace[1].at < trace[2].at);
});
