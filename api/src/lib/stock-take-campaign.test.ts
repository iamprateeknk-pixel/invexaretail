import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCampaignTransition,
  canTransitionCampaign,
  deriveCampaignStatus,
  deriveItemState,
  endOfLocalDayIso,
  isDateOnly,
  isValidTimezone,
  localDateString,
  parseDailyItemsPerUser,
  parsePriorityOrder,
  planDailyAllocation,
  prioritizeItems,
  summarizeProgress,
  type AssignmentFact,
  type CountFact,
} from './stock-take-campaign.js';

test('campaign state machine allows the blueprint flow and blocks terminal states', () => {
  assert.equal(canTransitionCampaign('DRAFT', 'ACTIVE'), true);
  assert.equal(canTransitionCampaign('ACTIVE', 'COUNTING'), true);
  assert.equal(canTransitionCampaign('COUNTING', 'IN_REVIEW'), true);
  assert.equal(canTransitionCampaign('IN_REVIEW', 'COMPLETED'), true);
  assert.equal(canTransitionCampaign('COUNTING', 'PAUSED'), true);
  assert.equal(canTransitionCampaign('PAUSED', 'COUNTING'), true);
  assert.equal(canTransitionCampaign('DRAFT', 'COUNTING'), false);
  assert.equal(canTransitionCampaign('DRAFT', 'PAUSED'), false);
  assert.equal(canTransitionCampaign('COMPLETED', 'ACTIVE'), false);
  assert.equal(canTransitionCampaign('CANCELLED', 'ACTIVE'), false);
  assert.throws(() => assertCampaignTransition('COMPLETED', 'PAUSED'), /cannot move/);
});

test('campaign inputs are validated', () => {
  assert.deepEqual(parsePriorityOrder(undefined), ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY']);
  assert.deepEqual(parsePriorityOrder(['abc', 'ABC', 'expiry']), ['ABC', 'EXPIRY']);
  assert.throws(() => parsePriorityOrder([]), /non-empty/);
  assert.throws(() => parsePriorityOrder(['LUCKY']), /must be one of/);
  assert.equal(parseDailyItemsPerUser('25'), 25);
  for (const bad of [0, -1, 1.5, 501, 'x', null]) assert.throws(() => parseDailyItemsPerUser(bad), /dailyItemsPerUser/);
  assert.equal(isValidTimezone('Asia/Kolkata'), true);
  assert.equal(isValidTimezone('Mars/Base'), false);
  assert.equal(isDateOnly('2026-09-18'), true);
  assert.equal(isDateOnly('2026-13-40'), false);
  assert.equal(isDateOnly('18-09-2026'), false);
});

test('local dates and due times follow the campaign timezone, not the server clock', () => {
  // 20:00 UTC on 18 Sep is already 19 Sep 01:30 in India.
  assert.equal(localDateString(new Date('2026-09-18T20:00:00Z'), 'Asia/Kolkata'), '2026-09-19');
  assert.equal(localDateString(new Date('2026-09-18T20:00:00Z'), 'UTC'), '2026-09-18');
  assert.equal(endOfLocalDayIso('2026-09-18', 'Asia/Kolkata'), '2026-09-18T18:29:59.000Z');
  assert.equal(endOfLocalDayIso('2026-09-18', 'UTC'), '2026-09-18T23:59:59.000Z');
});

test('prioritisation: never counted, then oldest counted, then ABC, then expiry - deterministic', () => {
  const items = [
    { itemId: 'i-c', lastCountedAt: '2026-08-01T00:00:00Z' },
    { itemId: 'i-a', lastCountedAt: '2026-09-01T00:00:00Z' },
    { itemId: 'i-never-2' },
    { itemId: 'i-b', lastCountedAt: '2026-08-01T00:00:00Z' },
    { itemId: 'i-never-1' },
  ];
  const context = {
    abcClass: new Map([['i-never-1', 'C' as const], ['i-never-2', 'A' as const], ['i-b', 'A' as const], ['i-c', 'B' as const]]),
    nearestExpiry: new Map([['i-c', '2026-10-01'], ['i-b', '2026-12-01']]),
  };
  const ordered = prioritizeItems(items, ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY'], context).map((row) => row.itemId);
  // Never counted first (A before C); then oldest date, ABC breaks the 08-01 tie (A before B); newest last.
  assert.deepEqual(ordered, ['i-never-2', 'i-never-1', 'i-b', 'i-c', 'i-a']);
  assert.deepEqual(prioritizeItems([...items].reverse(), ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY'], context).map((row) => row.itemId), ordered);

  // Expiry-first chain ranks the item expiring soonest ahead of items with no expiry.
  const byExpiry = prioritizeItems(items, ['EXPIRY'], context).map((row) => row.itemId);
  assert.deepEqual(byExpiry.slice(0, 2), ['i-c', 'i-b']);
});

test('allocation tops users up to quota, most-urgent first, balanced across users', () => {
  const candidates = ['p1', 'p2', 'p3', 'p4', 'p5'].map((itemId) => ({ itemId }));
  const plan = planDailyAllocation({ candidates, userIds: ['u1', 'u2'], openLoad: new Map(), dailyItemsPerUser: 2 });
  assert.deepEqual(plan, [
    { itemId: 'p1', userId: 'u1' },
    { itemId: 'p2', userId: 'u2' },
    { itemId: 'p3', userId: 'u1' },
    { itemId: 'p4', userId: 'u2' },
  ]);
  // Quota exhausted: the fifth item waits for tomorrow rather than overloading anyone.
  assert.equal(plan.some((row) => row.itemId === 'p5'), false);
});

test('rollover: unfinished tasks count toward the quota, so nothing is duplicated', () => {
  const candidates = ['n1', 'n2', 'n3'].map((itemId) => ({ itemId }));
  const plan = planDailyAllocation({
    candidates,
    userIds: ['u1', 'u2'],
    openLoad: new Map([['u1', 4], ['u2', 1]]),
    dailyItemsPerUser: 5,
  });
  // u1 has room for 1, u2 for 4; the least-loaded user is always served first.
  assert.deepEqual(plan.map((row) => row.userId), ['u2', 'u2', 'u2']);
  const full = planDailyAllocation({ candidates, userIds: ['u1'], openLoad: new Map([['u1', 5]]), dailyItemsPerUser: 5 });
  assert.deepEqual(full, []);
  assert.deepEqual(planDailyAllocation({ candidates, userIds: [], openLoad: new Map(), dailyItemsPerUser: 5 }), []);
});

test('a recount avoids the original counter when someone else has capacity', () => {
  const plan = planDailyAllocation({
    candidates: [{ itemId: 'r1', avoidUserId: 'u1' }],
    userIds: ['u1', 'u2'],
    openLoad: new Map([['u1', 0], ['u2', 3]]),
    dailyItemsPerUser: 5,
  });
  assert.deepEqual(plan, [{ itemId: 'r1', userId: 'u2' }]);
  const onlyOne = planDailyAllocation({
    candidates: [{ itemId: 'r1', avoidUserId: 'u1' }],
    userIds: ['u1'],
    openLoad: new Map(),
    dailyItemsPerUser: 5,
  });
  assert.deepEqual(onlyOne, [{ itemId: 'r1', userId: 'u1' }]);
});

const assignment = (over: Partial<AssignmentFact>): AssignmentFact => ({
  id: 'a1', itemId: 'i1', assignedToId: 'u1', status: 'ASSIGNED', createdAt: '2026-09-18T00:00:00Z', ...over,
});
const count = (over: Partial<CountFact> & { id: string }): CountFact => ({ createdAt: '2026-09-18T06:00:00Z', ...over });

test('item state is derived from assignments and counts, never trusted from a cache', () => {
  const base = { status: 'PENDING' as const, recounts: 0 };
  assert.equal(deriveItemState(base, [], new Map()).status, 'PENDING');
  assert.equal(deriveItemState({ ...base, status: 'EXCLUDED' }, [], new Map()).status, 'EXCLUDED');
  assert.equal(deriveItemState(base, [assignment({})], new Map()).status, 'ASSIGNED');
  assert.equal(deriveItemState(base, [assignment({ status: 'CANCELLED' })], new Map()).status, 'PENDING');

  const submitted = assignment({ status: 'SUBMITTED', countId: 'c1' });
  assert.equal(deriveItemState(base, [submitted], new Map([['c1', count({ id: 'c1', status: 'PENDING_REVIEW' })]])).status, 'SUBMITTED');
  const approved = deriveItemState(base, [submitted], new Map([['c1', count({ id: 'c1', status: 'APPROVED' })]]));
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.lastCountedAt, '2026-09-18T06:00:00Z');
  assert.equal(deriveItemState(base, [submitted], new Map([['c1', count({ id: 'c1', status: 'REJECTED' })]])).status, 'DISPOSITIONED');
});

test('a recount is an explicit linked task: the item returns to RECOUNT, then to review, then approved', () => {
  const base = { status: 'SUBMITTED' as const, recounts: 0 };
  const first = assignment({ id: 'a1', status: 'CANCELLED', countId: 'c1', createdAt: '2026-09-18T00:00:00Z' });
  const recount = assignment({ id: 'a2', parentCountId: 'c1', createdAt: '2026-09-19T00:00:00Z' });
  const counts = new Map([['c1', count({ id: 'c1', status: 'RECOUNT' })]]);

  const open = deriveItemState(base, [first, recount], counts);
  assert.equal(open.status, 'RECOUNT');
  assert.equal(open.assignmentId, 'a2');
  assert.equal(open.recounts, 1);

  const resubmitted = { ...recount, status: 'SUBMITTED' as const, countId: 'c2' };
  counts.set('c2', count({ id: 'c2', status: 'PENDING_REVIEW', createdAt: '2026-09-19T05:00:00Z' }));
  assert.equal(deriveItemState(base, [first, resubmitted], counts).status, 'SUBMITTED');

  counts.set('c2', count({ id: 'c2', status: 'APPROVED', createdAt: '2026-09-19T05:00:00Z' }));
  const done = deriveItemState(base, [first, resubmitted], counts);
  assert.equal(done.status, 'APPROVED');
  assert.equal(done.lastCountedAt, '2026-09-19T05:00:00Z');
});

test('campaign status follows the work and completes only at 100% coverage', () => {
  const s = (status: string) => ({ status: status as never });
  assert.equal(deriveCampaignStatus('ACTIVE', [s('PENDING'), s('PENDING')]), 'ACTIVE');
  assert.equal(deriveCampaignStatus('ACTIVE', [s('ASSIGNED'), s('PENDING')]), 'COUNTING');
  assert.equal(deriveCampaignStatus('COUNTING', [s('SUBMITTED'), s('SUBMITTED')]), 'IN_REVIEW');
  assert.equal(deriveCampaignStatus('COUNTING', [s('SUBMITTED'), s('RECOUNT')]), 'COUNTING');
  assert.equal(deriveCampaignStatus('IN_REVIEW', [s('APPROVED'), s('DISPOSITIONED'), s('EXCLUDED')]), 'COMPLETED');
  assert.equal(deriveCampaignStatus('IN_REVIEW', [s('APPROVED'), s('SUBMITTED')]), 'IN_REVIEW');
  // Paused/draft campaigns are never advanced by work happening around them.
  assert.equal(deriveCampaignStatus('PAUSED', [s('APPROVED')]), 'PAUSED');
  assert.equal(deriveCampaignStatus('DRAFT', [s('APPROVED')]), 'DRAFT');
});

test('progress excludes EXCLUDED items from coverage', () => {
  const summary = summarizeProgress([{ status: 'APPROVED' }, { status: 'DISPOSITIONED' }, { status: 'PENDING' }, { status: 'EXCLUDED' }]);
  assert.equal(summary.total, 4);
  assert.equal(summary.eligible, 3);
  assert.equal(summary.covered, 2);
  assert.equal(summary.coveragePercent, 67);
  assert.equal(summarizeProgress([]).coveragePercent, 100);
});

// 20-Week Developer Execution Guide, Week 12 mandatory acceptance examples
// (verbatim): "100 products/3 users without a daily cap distributes 33, 33
// and 34" and "With daily cap 20, day/batch one assigns 20/20/20, next
// assigns 20/20/20 ... with no duplicate or missing product." These were
// never directly asserted before - only planDailyAllocation's general
// shape (least-loaded, avoid-user, capacity) had coverage.
test('Week 12 acceptance: 100 items across 3 users with no daily cap distributes 33/33/34', () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({ itemId: `item-${i + 1}` }));
  const plan = planDailyAllocation({
    candidates,
    userIds: ['u1', 'u2', 'u3'],
    openLoad: new Map(),
    dailyItemsPerUser: 100, // effectively unlimited for this run
  });
  assert.equal(plan.length, 100, 'every item must be assigned exactly once');
  const perUser = new Map<string, number>();
  for (const { userId } of plan) perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
  assert.deepEqual(new Set(perUser.keys()), new Set(['u1', 'u2', 'u3']), 'no user goes unassigned');
  const counts = [...perUser.values()].sort((a, b) => a - b);
  assert.deepEqual(counts, [33, 33, 34]);
  const assignedIds = plan.map((row) => row.itemId);
  assert.equal(new Set(assignedIds).size, 100, 'no duplicate product across users');
});

test('Week 12 acceptance: daily cap 20 assigns 20/20/20 on each of two consecutive days with no duplicate or missing product', () => {
  const totalItems = 140;
  const allItemIds = Array.from({ length: totalItems }, (_, i) => `item-${i + 1}`);
  const userIds = ['u1', 'u2', 'u3'];
  const assignedSoFar = new Set<string>();

  function runDay(remainingItemIds: string[]) {
    const candidates = remainingItemIds.map((itemId) => ({ itemId }));
    // Each day starts everyone's open load at zero, matching how
    // runCampaignDay only counts still-open rollover tasks, not
    // already-completed ones - a finished prior day carries no load.
    return planDailyAllocation({ candidates, userIds, openLoad: new Map(), dailyItemsPerUser: 20 });
  }

  // Day 1: 60 available of the 140-item pool, capped at 20/user -> exactly 20/20/20.
  const day1Remaining = allItemIds.filter((id) => !assignedSoFar.has(id));
  const day1Plan = runDay(day1Remaining);
  for (const { itemId } of day1Plan) assignedSoFar.add(itemId);
  const day1PerUser = new Map<string, number>();
  for (const { userId } of day1Plan) day1PerUser.set(userId, (day1PerUser.get(userId) ?? 0) + 1);
  assert.deepEqual([...day1PerUser.values()].sort(), [20, 20, 20]);

  // Day 2: still 80 unassigned, capped at 20/user again -> another 20/20/20.
  const day2Remaining = allItemIds.filter((id) => !assignedSoFar.has(id));
  const day2Plan = runDay(day2Remaining);
  for (const { itemId } of day2Plan) assignedSoFar.add(itemId);
  const day2PerUser = new Map<string, number>();
  for (const { userId } of day2Plan) day2PerUser.set(userId, (day2PerUser.get(userId) ?? 0) + 1);
  assert.deepEqual([...day2PerUser.values()].sort(), [20, 20, 20]);

  // No duplicate or missing product across the two days: exactly 120 of the
  // 140 total assigned so far, each exactly once.
  assert.equal(assignedSoFar.size, 120);
  const allAssignedIds = [...day1Plan, ...day2Plan].map((row) => row.itemId);
  assert.equal(new Set(allAssignedIds).size, 120, 'no product assigned twice across days');

  // Day 3: the final 20 items remain, still 3 active users. This algorithm's
  // real, honest behavior for 20 items over 3 users is the least-loaded
  // round-robin (7/7/6), not the guide's "10/10 to two users" wording - that
  // phrasing describes a user going unavailable that day (a separate,
  // already-covered reassignment path via reassignWorkload/
  // cancelOpenAssignments), not a property of planDailyAllocation itself.
  // What the guide's "no duplicate or missing product" requirement asks for
  // is checked directly: every remaining item assigned, none twice, none lost.
  const day3Remaining = allItemIds.filter((id) => !assignedSoFar.has(id));
  assert.equal(day3Remaining.length, 20);
  const day3Plan = runDay(day3Remaining);
  assert.equal(day3Plan.length, 20, 'the final day must not drop or duplicate any remaining product');
  const day3PerUser = new Map<string, number>();
  for (const { userId } of day3Plan) day3PerUser.set(userId, (day3PerUser.get(userId) ?? 0) + 1);
  assert.deepEqual([...day3PerUser.values()].sort((a, b) => a - b), [6, 7, 7]);

  const finalAllIds = [...day1Plan, ...day2Plan, ...day3Plan].map((row) => row.itemId);
  assert.equal(new Set(finalAllIds).size, totalItems, 'every one of the 140 products was assigned exactly once across all three days');
});
