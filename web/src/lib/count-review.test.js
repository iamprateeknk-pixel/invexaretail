import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReviewNoteIsValid,
  displayCountPriority,
  displayCountStatus,
  isCountManager,
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
