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
  planFairAssignment,
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

// ---- Week 12 guide acceptance examples -------------------------------------

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(3, '0')}`);
const counts = (batch: { assignments: Array<{ itemIds: string[] }> }) => batch.assignments.map((a) => a.itemIds.length);

test('week 12: 100 products across three users without a daily cap distributes 33/33/34', () => {
  const plan = planFairAssignment(ids(100), ['u1', 'u2', 'u3']);
  assert.equal(plan.length, 1);
  assert.deepEqual(counts(plan[0]), [33, 33, 34]);
});

test('week 12: daily cap 20 -> 20/20/20, 20/20/20, then final 10/10 to two users', () => {
  const plan = planFairAssignment(ids(140), ['u1', 'u2', 'u3'], 20);
  assert.deepEqual(plan.map(counts), [[20, 20, 20], [20, 20, 20], [10, 10]]);
});

test('week 12: assignment never duplicates or drops a product, and is deterministic', () => {
  for (const [n, users, cap] of [[100, 3, undefined], [140, 3, 20], [97, 4, 7], [5, 3, 20], [1, 5, undefined]] as const) {
    const userIds = Array.from({ length: users }, (_, i) => `u${i + 1}`);
    const plan = planFairAssignment(ids(n), userIds, cap);
    const all = plan.flatMap((b) => b.assignments.flatMap((a) => a.itemIds));
    assert.deepEqual(all, ids(n), `n=${n} users=${users} cap=${cap}`);
    assert.deepEqual(planFairAssignment(ids(n), userIds, cap), plan);
    if (cap !== undefined) for (const b of plan) for (const a of b.assignments) assert.ok(a.itemIds.length <= cap);
  }
  assert.deepEqual(planFairAssignment([], ['u1']), []);
  assert.deepEqual(planFairAssignment(ids(3), []), []);
  assert.throws(() => planFairAssignment(ids(3), ['u1'], 0), /dailyLimit/);
});
