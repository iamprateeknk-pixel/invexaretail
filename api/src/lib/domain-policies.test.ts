// Week 7: transition-map coverage for the six named entities. Pure logic
// (allowed*Moves tables) runs in memory mode; the async assert* wrappers
// also write an audit-log row when DB-backed, covered separately by the
// .postgres.test.ts suites for the modules they wrap.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedCountReviewMoves,
  allowedOrderMoves,
  assertValidCountReviewTransition,
  assertValidOrderTransition,
  assertInspectionResultImmutable,
  InvalidTransitionError,
} from './domain-policies.js';
import { isDomainError } from './errors.js';

test('StockCount review: PENDING_REVIEW can move to APPROVED, REJECTED or RECOUNT, never directly to itself', () => {
  assert.deepEqual(allowedCountReviewMoves('PENDING_REVIEW').sort(), ['APPROVED', 'RECOUNT', 'REJECTED']);
  assert.deepEqual(allowedCountReviewMoves('APPROVED'), []);
  assert.deepEqual(allowedCountReviewMoves('REJECTED'), []);
  assert.deepEqual(allowedCountReviewMoves('RECOUNT'), ['PENDING_REVIEW']);
});

test('StockCount review: an illegal transition is rejected as a stable, catalogued DomainError with a trace ID', async () => {
  await assert.rejects(
    () => assertValidCountReviewTransition('APPROVED', 'REJECTED', 'count-1', { actorId: 'u1', actorRole: 'ADMIN' }),
    (error: unknown) => {
      assert.ok(isDomainError(error));
      assert.ok(error instanceof InvalidTransitionError);
      assert.equal((error as InvalidTransitionError).code, 'INVALID_TRANSITION');
      assert.ok((error as InvalidTransitionError).traceId, 'a trace ID must always be present, generated if the caller did not supply one');
      return true;
    },
  );
});

test('StockCount review: a legal transition does not throw', async () => {
  await assert.doesNotReject(() => assertValidCountReviewTransition('PENDING_REVIEW', 'APPROVED', 'count-2', { actorId: 'u1', actorRole: 'ADMIN' }));
});

test('Order: RESERVED can move to FULFILLED, CANCELLED, EXPIRED or BACKORDERED', () => {
  assert.deepEqual(allowedOrderMoves('RESERVED').sort(), ['BACKORDERED', 'CANCELLED', 'EXPIRED', 'FULFILLED']);
  assert.deepEqual(allowedOrderMoves('FULFILLED'), [], 'FULFILLED is terminal - stock has physically shipped, it cannot un-fulfil');
  assert.deepEqual(allowedOrderMoves('CANCELLED'), []);
  assert.deepEqual(allowedOrderMoves('EXPIRED'), []);
});

test('Order: a fulfilled order cannot be cancelled - the exact rule the old ad hoc check in orders.ts enforced, now centrally', async () => {
  await assert.rejects(
    () => assertValidOrderTransition('FULFILLED', 'CANCELLED', 'order-1', { actorId: 'system', actorRole: 'SYSTEM' }),
    InvalidTransitionError,
  );
});

test('Order: reusing a supplied trace ID keeps the same trace ID on the thrown error', async () => {
  const traceId = 'trace-abc-123';
  await assert.rejects(
    () => assertValidOrderTransition('FULFILLED', 'RESERVED', 'order-2', { actorId: 'system', actorRole: 'SYSTEM' }, traceId),
    (error: unknown) => {
      assert.equal((error as InvalidTransitionError).traceId, traceId);
      return true;
    },
  );
});

test('QcInspection: overallResult is write-once - setting it once is fine, changing an existing result throws', () => {
  assert.doesNotThrow(() => assertInspectionResultImmutable(null, 'insp-1'));
  assert.doesNotThrow(() => assertInspectionResultImmutable(undefined, 'insp-1'));
  assert.throws(() => assertInspectionResultImmutable('PASS', 'insp-1'), InvalidTransitionError);
});
