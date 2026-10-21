import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { thresholdsAsNumbers } from './decimal-json.js';
import { countRowToRecord } from './count-record-mapper.js';
import { presentSupplier } from './supplier-master.js';

// Slice 2 of the quantity Decimal migration (R6): the shared boundary helpers
// must turn Prisma Decimal quantities back into plain numbers, or API JSON
// would emit them as strings and typed-number consumers would break.

test('thresholdsAsNumbers converts a Decimal quantityThreshold and valueThreshold to numbers', () => {
  const row = thresholdsAsNumbers({
    id: 'r1',
    valueThreshold: new Prisma.Decimal('1250.50'),
    quantityThreshold: new Prisma.Decimal('7.250'),
  });
  assert.equal(row.valueThreshold, 1250.5);
  assert.equal((row as { quantityThreshold?: unknown }).quantityThreshold, 7.25);
  assert.equal(typeof (row as { quantityThreshold?: unknown }).quantityThreshold, 'number');
});

test('thresholdsAsNumbers keeps a null quantityThreshold null and never adds the key to rows that lack it', () => {
  const withNull = thresholdsAsNumbers({ id: 'r2', valueThreshold: null, quantityThreshold: null });
  assert.equal((withNull as { quantityThreshold?: unknown }).quantityThreshold, null);

  const approvalStyle = thresholdsAsNumbers({ id: 'r3', valueThreshold: new Prisma.Decimal('10') });
  assert.equal('quantityThreshold' in approvalStyle, false);
  assert.equal(approvalStyle.valueThreshold, 10);
});

test('countRowToRecord converts Decimal count quantities into record numbers', () => {
  const record = countRowToRecord({
    id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc1',
    physicalQty: new Prisma.Decimal('7.5'), bookQty: new Prisma.Decimal('10'),
    mode: 'manual', submittedById: 'u1', createdAt: new Date('2026-01-01T00:00:00.000Z'),
    reviewStatus: 'APPROVED', approvedById: null, approvedAt: null, reviewReason: null, parentCountId: null,
    bookQtyOriginal: new Prisma.Decimal('9.5'), lateDelta: new Prisma.Decimal('0.5'),
  } as never, 'ADMIN');
  assert.equal(record.physicalQuantity, 7.5);
  assert.equal(record.bookQty, 10);
  assert.equal(record.bookQtyOriginal, 9.5);
  assert.equal(record.lateDelta, 0.5);
});

test('countRowToRecord defaults a missing lateDelta to 0 and an absent bookQtyOriginal to undefined', () => {
  const record = countRowToRecord({
    id: 'c2', itemId: 'i1', lotId: 'l1', locationId: 'loc1',
    physicalQty: 3, bookQty: 3,
    mode: 'scan', submittedById: 'u1', createdAt: new Date('2026-01-01T00:00:00.000Z'),
    reviewStatus: 'PENDING_REVIEW', approvedById: null, approvedAt: null, reviewReason: null, parentCountId: null,
  } as never, 'ADMIN');
  assert.equal(record.physicalQuantity, 3);
  assert.equal(record.bookQtyOriginal, undefined);
  assert.equal(record.lateDelta, 0);
});

test('presentSupplier converts a Decimal moq to a number and keeps null as null', () => {
  assert.equal(presentSupplier({ id: 's1', categories: 'Dry', moq: new Prisma.Decimal('25.5') }).moq, 25.5);
  assert.equal(presentSupplier({ id: 's2', categories: null, moq: null }).moq, null);
});
