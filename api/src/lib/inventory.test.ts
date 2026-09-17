import test from 'node:test';
import assert from 'node:assert/strict';

import { computeVariance, canAccessLocation, sanitizeStockForRole, validateTransferStatusChange } from './inventory.js';

test('computeVariance returns the physical minus book delta', () => {
  assert.equal(computeVariance(120, 135), 15);
  assert.equal(computeVariance(120, 110), -10);
});

test('admin can access all locations, while a store user is restricted to assigned stores', () => {
  assert.equal(canAccessLocation({ role: 'ADMIN', assignedLocationIds: ['loc-1', 'loc-2'] }, 'loc-3'), true);
  assert.equal(canAccessLocation({ role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] }, 'loc-1'), true);
  assert.equal(canAccessLocation({ role: 'BRANCH_MANAGER', assignedLocationIds: ['loc-1'] }, 'loc-2'), false);
  assert.equal(canAccessLocation({ role: 'STORE_USER', assignedLocationIds: ['loc-1'] }, 'loc-2'), false);
  assert.equal(canAccessLocation({ role: 'STORE_USER', assignedLocationIds: ['loc-1'] }, 'loc-1'), true);
});

test('a company admin cannot access another company location even as ADMIN', () => {
  assert.equal(canAccessLocation({ role: 'ADMIN', assignedLocationIds: [], companyId: 'default-company' }, 'loc-1'), true);
  assert.equal(canAccessLocation({ role: 'ADMIN', assignedLocationIds: [], companyId: 'company-jaipur' }, 'loc-1'), false);
});

test('store users only receive physical quantities and never system stock values', () => {
  const sanitized = sanitizeStockForRole('STORE_USER', {
    itemId: 'item-1',
    locationId: 'loc-1',
    bookQuantity: 32,
    physicalQuantity: 28,
    variance: -4,
    stockValue: 1280,
  });

  assert.deepEqual(sanitized, {
    itemId: 'item-1',
    locationId: 'loc-1',
    physicalQuantity: 28,
  });
});

test('transfer status changes follow role-specific lifecycle rules', () => {
  assert.doesNotThrow(() => validateTransferStatusChange('ADMIN', 'CONFIRMED', 'DISPATCHED'));
  assert.doesNotThrow(() => validateTransferStatusChange('ADMIN', 'DISPATCHED', 'IN_TRANSIT'));
  assert.doesNotThrow(() => validateTransferStatusChange('WAREHOUSE_PICKER', 'REQUESTED', 'PICKED'));
  assert.throws(() => validateTransferStatusChange('AUDITOR', 'REQUESTED', 'DISPATCHED'));
  assert.throws(() => validateTransferStatusChange('STORE_USER', 'DISPATCHED', 'RECEIVED'));
  assert.throws(() => validateTransferStatusChange('ADMIN', 'REQUESTED', 'DISPATCHED'));
});
