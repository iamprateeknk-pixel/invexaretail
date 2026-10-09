import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReviewNoteIsValid,
  displayCountPriority,
  displayCountStatus,
  countsBlind,
  isCountManager,
  isCountWorker,
} from './count-review.js';

test('count managers include branch managers and exclude store users', () => {
  assert.equal(isCountManager('ADMIN'), true);
  assert.equal(isCountManager('BRANCH_MANAGER'), true);
  assert.equal(isCountManager('STORE_USER'), false);
});

test('review notes must be at least five trimmed characters', () => {
  assert.equal(countReviewNoteIsValid('ok'), false);
  assert.equal(countReviewNoteIsValid('  note  '), false);
  assert.equal(countReviewNoteIsValid('Damaged units'), true);
});

test('count statuses and priorities map to operator-facing labels', () => {
  assert.equal(displayCountStatus('RECOUNT'), 'Recount');
  assert.equal(displayCountStatus('PENDING_REVIEW'), 'Pending review');
  assert.equal(displayCountPriority('HIGH'), 'Urgent');
  assert.equal(displayCountPriority('NORMAL', true), 'Urgent');
  assert.equal(displayCountPriority('LOW'), 'Low');
});

test('branch managers can be given count work but, unlike store users and pickers, do not count blind', () => {
  for (const role of ['STORE_USER', 'WAREHOUSE_PICKER', 'BRANCH_MANAGER']) assert.equal(isCountWorker(role), true, role);
  for (const role of ['ADMIN', 'ADMIN_USER', 'AUDITOR']) assert.equal(isCountWorker(role), false, role);
  assert.equal(countsBlind('STORE_USER'), true);
  assert.equal(countsBlind('WAREHOUSE_PICKER'), true);
  assert.equal(countsBlind('BRANCH_MANAGER'), false);
});
