import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCountLocationAccess,
  canManageCountWork,
  parseCountPriority,
  parseCountReviewReason,
  parseCountReviewStatus,
  parseOptionalDueDate,
} from './count-lifecycle.js';

test('admins and branch managers can manage count work; store users cannot', () => {
  assert.equal(canManageCountWork('ADMIN'), true);
  assert.equal(canManageCountWork('ADMIN_USER'), true);
  assert.equal(canManageCountWork('BRANCH_MANAGER'), true);
  assert.equal(canManageCountWork('STORE_USER'), false);
  assert.equal(canManageCountWork('AUDITOR'), false);
});

test('review notes must be at least five characters after trim', () => {
  assert.equal(parseCountReviewReason(' Damaged cartons found '), 'Damaged cartons found');
  assert.throws(() => parseCountReviewReason('nope'), /at least 5 characters/);
  assert.throws(() => parseCountReviewReason('   '), /at least 5 characters/);
});

test('review status accepts approve/reject aliases and recount', () => {
  assert.equal(parseCountReviewStatus('approve'), 'APPROVED');
  assert.equal(parseCountReviewStatus('REJECT'), 'REJECTED');
  assert.equal(parseCountReviewStatus('RECOUNT'), 'RECOUNT');
  assert.throws(() => parseCountReviewStatus('PENDING_REVIEW'), /APPROVED, REJECTED, or RECOUNT/);
});

test('priority aliases urgent to HIGH and defaults blank to NORMAL', () => {
  assert.equal(parseCountPriority(undefined), 'NORMAL');
  assert.equal(parseCountPriority('urgent'), 'HIGH');
  assert.equal(parseCountPriority('low'), 'LOW');
  assert.throws(() => parseCountPriority('critical'), /LOW, NORMAL, or HIGH/);
});

test('optional due dates reject invalid values and keep empty optional', () => {
  assert.equal(parseOptionalDueDate(''), undefined);
  assert.ok(parseOptionalDueDate('2026-09-20T12:00:00.000Z')?.startsWith('2026-09-20'));
  assert.throws(() => parseOptionalDueDate('not-a-date'), /Due date is invalid/);
});

test('branch managers are limited to assigned locations for count work', () => {
  const manager = { role: 'BRANCH_MANAGER' as const, assignedLocationIds: ['loc-1'] };
  assert.doesNotThrow(() => assertCountLocationAccess(manager, 'loc-1'));
  assert.throws(() => assertCountLocationAccess(manager, 'loc-2'), /cannot manage counts/);
  assert.doesNotThrow(() => assertCountLocationAccess({ role: 'ADMIN', assignedLocationIds: [] }, 'loc-2'));
});
