import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyCampaignAssignments } from './stock-take-campaign.js';

test('assigns only positive branch stock and balances daily capacity across users', () => {
  const result = buildDailyCampaignAssignments({
    dailyItemsPerUser: 2,
    users: [{ userId: 'u1' }, { userId: 'u2' }],
    candidates: [
      { itemId: 'a', onHand: 1 },
      { itemId: 'b', onHand: 5 },
      { itemId: 'zero', onHand: 0 },
      { itemId: 'c', onHand: 2 },
      { itemId: 'd', onHand: 3 },
      { itemId: 'overflow', onHand: 4 },
    ],
  });

  assert.equal(result.length, 4);
  assert.equal(result.some((row) => row.itemId === 'zero'), false);
  assert.equal(result.filter((row) => row.userId === 'u1').length, 2);
  assert.equal(result.filter((row) => row.userId === 'u2').length, 2);
  assert.equal(new Set(result.map((row) => row.itemId)).size, result.length);
});

test('never duplicates completed or already-open campaign items on a new day', () => {
  const result = buildDailyCampaignAssignments({
    dailyItemsPerUser: 10,
    users: [{ userId: 'u1' }],
    completedItemIds: ['done'],
    openTasks: [{ itemId: 'carry', userId: 'u1', status: 'IN_PROGRESS' }],
    candidates: [
      { itemId: 'done', onHand: 1 },
      { itemId: 'carry', onHand: 1 },
      { itemId: 'fresh', onHand: 1 },
    ],
  });

  assert.deepEqual(result.map((row) => row.itemId), ['fresh']);
});

test('prioritizes never-counted items before the oldest previously-counted item', () => {
  const result = buildDailyCampaignAssignments({
    dailyItemsPerUser: 3,
    users: [{ userId: 'u1' }],
    candidates: [
      { itemId: 'recent', onHand: 1, lastCountedAt: '2026-09-18T00:00:00Z' },
      { itemId: 'never', onHand: 1, lastCountedAt: null },
      { itemId: 'old', onHand: 1, lastCountedAt: '2026-08-01T00:00:00Z' },
    ],
  });

  assert.deepEqual(result.map((row) => row.itemId), ['never', 'old', 'recent']);
});
