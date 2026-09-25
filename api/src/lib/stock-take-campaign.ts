import type { AbcClass } from './abc-cycle-count.js';

// Blueprint v4 §12-14 / Appendix A: a monthly stock-take campaign replaces
// item-by-item manual assignment. The pure rules live here (state machine,
// prioritisation, balanced allocation, status derivation); lib/campaign-
// service.ts wires them to the repository, scheduler and persistence.

import { BUSINESS_TIMEZONE } from './expiry-date.js';

export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'COUNTING', 'IN_REVIEW', 'COMPLETED', 'PAUSED', 'CANCELLED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// PENDING = in the queue, not yet handed to anyone.
// ASSIGNED / SUBMITTED / RECOUNT mirror the count-task flow; APPROVED and
// DISPOSITIONED (review rejected the count) are terminal "covered" states.
// EXCLUDED = left out of coverage (e.g. stock fell to zero before counting).
export const CAMPAIGN_ITEM_STATUSES = ['PENDING', 'ASSIGNED', 'SUBMITTED', 'APPROVED', 'RECOUNT', 'DISPOSITIONED', 'EXCLUDED'] as const;
export type CampaignItemStatus = (typeof CAMPAIGN_ITEM_STATUSES)[number];

export const PRIORITY_KEYS = ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY'] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];
export const DEFAULT_PRIORITY_ORDER: PriorityKey[] = ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY'];

export const DEFAULT_CAMPAIGN_TIMEZONE = BUSINESS_TIMEZONE;
export const MAX_DAILY_ITEMS_PER_USER = 500;

export type CampaignRecord = {
  id: string;
  companyId: string;
  name: string;
  locationId: string;
  status: CampaignStatus;
  dailyItemsPerUser: number;
  userIds: string[];
  priorityOrder: PriorityKey[];
  includeNewStock: boolean;
  timezone: string;
  // Local calendar dates (YYYY-MM-DD) in `timezone`.
  startDate: string;
  endDate?: string;
  lastRunDate?: string;
  pausedFrom?: CampaignStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
};

export type CampaignItemRecord = {
  campaignId: string;
  itemId: string;
  status: CampaignItemStatus;
  excludedReason?: string;
  assignedToId?: string;
  assignmentId?: string;
  countId?: string;
  assignedDate?: string;
  lastCountedAt?: string;
  recounts: number;
  addedAt: string;
  updatedAt: string;
};

// ---- state machine --------------------------------------------------------

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COUNTING', 'IN_REVIEW', 'COMPLETED', 'PAUSED', 'CANCELLED'],
  COUNTING: ['ACTIVE', 'IN_REVIEW', 'COMPLETED', 'PAUSED', 'CANCELLED'],
  IN_REVIEW: ['ACTIVE', 'COUNTING', 'COMPLETED', 'PAUSED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'COUNTING', 'IN_REVIEW', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertCampaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransitionCampaign(from, to)) {
    throw new Error(`A ${from.toLowerCase().replace('_', ' ')} campaign cannot move to ${to.toLowerCase().replace('_', ' ')}.`);
  }
}

/** Campaigns that still own work: at most one may exist per location. */
export function isOpenCampaign(status: CampaignStatus): boolean {
  return status !== 'COMPLETED' && status !== 'CANCELLED';
}

/** Campaigns the daily scheduler and item sync act on. */
export function isRunnableCampaign(status: CampaignStatus): boolean {
  return status === 'ACTIVE' || status === 'COUNTING' || status === 'IN_REVIEW';
}

// ---- input parsing --------------------------------------------------------

export function parsePriorityOrder(value: unknown): PriorityKey[] {
  if (value === undefined || value === null) return [...DEFAULT_PRIORITY_ORDER];
  if (!Array.isArray(value) || value.length === 0) throw new Error('priorityOrder must be a non-empty list.');
  const seen = new Set<PriorityKey>();
  for (const entry of value) {
    const key = String(entry).trim().toUpperCase() as PriorityKey;
    if (!(PRIORITY_KEYS as readonly string[]).includes(key)) {
      throw new Error(`priorityOrder entries must be one of ${PRIORITY_KEYS.join(', ')}.`);
    }
    seen.add(key);
  }
  return [...seen];
}

export function parseDailyItemsPerUser(value: unknown): number {
  const quota = Number(value);
  if (!Number.isInteger(quota) || quota < 1 || quota > MAX_DAILY_ITEMS_PER_USER) {
    throw new Error(`dailyItemsPerUser must be a whole number between 1 and ${MAX_DAILY_ITEMS_PER_USER}.`);
  }
  return quota;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

// ---- local calendar -------------------------------------------------------

/** The calendar date (YYYY-MM-DD) `instant` falls on in `timezone`. */
export function localDateString(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function timezoneOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** 00:00:00 local time on `dateOnly` in `timezone`, as an ISO instant. */
export function startOfLocalDayIso(dateOnly: string, timezone: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return new Date(guess.getTime() - timezoneOffsetMs(guess, timezone)).toISOString();
}

/** 23:59:59 local time on `dateOnly` in `timezone`, as an ISO instant. */
export function endOfLocalDayIso(dateOnly: string, timezone: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
  return new Date(guess.getTime() - timezoneOffsetMs(guess, timezone)).toISOString();
}

// ---- prioritisation -------------------------------------------------------

export type PriorityContext = {
  abcClass?: Map<string, AbcClass>;
  // Earliest lot expiry (ISO) among the item's positive-stock lots at the branch.
  nearestExpiry?: Map<string, string>;
};

const ABC_RANK: Record<AbcClass, number> = { A: 0, B: 1, C: 2 };

/**
 * Orders campaign items by the campaign's priority chain (blueprint §12:
 * never counted -> oldest counted -> ABC/risk/expiry/value). The chain is
 * applied in the configured order; itemId is the final tie-break so the
 * same inputs always produce the same queue.
 */
export function prioritizeItems<T extends { itemId: string; lastCountedAt?: string }>(
  items: T[],
  order: PriorityKey[],
  context: PriorityContext = {},
): T[] {
  const compare = (left: T, right: T): number => {
    for (const key of order) {
      let delta = 0;
      if (key === 'NEVER_COUNTED') {
        delta = Number(Boolean(left.lastCountedAt)) - Number(Boolean(right.lastCountedAt));
      } else if (key === 'OLDEST_COUNTED') {
        if (left.lastCountedAt && right.lastCountedAt) delta = left.lastCountedAt.localeCompare(right.lastCountedAt);
      } else if (key === 'ABC') {
        delta = ABC_RANK[context.abcClass?.get(left.itemId) ?? 'C'] - ABC_RANK[context.abcClass?.get(right.itemId) ?? 'C'];
      } else if (key === 'EXPIRY') {
        const l = context.nearestExpiry?.get(left.itemId);
        const r = context.nearestExpiry?.get(right.itemId);
        if (l && r) delta = l.localeCompare(r);
        else if (l || r) delta = l ? -1 : 1;
      }
      if (delta !== 0) return delta;
    }
    return left.itemId.localeCompare(right.itemId);
  };
  return [...items].sort(compare);
}

// ---- balanced daily allocation -------------------------------------------

export type AllocationInput = {
  // Already ordered by priority, highest first.
  candidates: Array<{ itemId: string; avoidUserId?: string }>;
  userIds: string[];
  // Tasks each user still has open (rolled over from earlier days).
  openLoad: Map<string, number>;
  dailyItemsPerUser: number;
};

/**
 * Tops every user up to `dailyItemsPerUser` open tasks, handing out the
 * highest-priority items first and always to the least-loaded user, so work
 * stays balanced. Unfinished tasks count toward the quota (rollover without
 * duplication). A recount avoids the user who did the original count when
 * anyone else has capacity.
 */
export function planDailyAllocation(input: AllocationInput): Array<{ itemId: string; userId: string }> {
  const load = new Map(input.userIds.map((userId) => [userId, input.openLoad.get(userId) ?? 0]));
  const order = new Map(input.userIds.map((userId, index) => [userId, index]));
  const withCapacity = () => input.userIds.filter((userId) => (load.get(userId) ?? 0) < input.dailyItemsPerUser);
  const plan: Array<{ itemId: string; userId: string }> = [];

  for (const candidate of input.candidates) {
    let pool = withCapacity();
    if (!pool.length) break;
    if (candidate.avoidUserId) {
      const others = pool.filter((userId) => userId !== candidate.avoidUserId);
      if (others.length) pool = others;
    }
    pool.sort((a, b) => (load.get(a)! - load.get(b)!) || (order.get(a)! - order.get(b)!));
    const userId = pool[0];
    load.set(userId, load.get(userId)! + 1);
    plan.push({ itemId: candidate.itemId, userId });
  }
  return plan;
}

// ---- guide-exact fair partition (Week 12 acceptance contract) -------------

export type FairBatch = {
  batch: number;
  assignments: Array<{ userId: string; itemIds: string[] }>;
};

/**
 * Deterministic, duplicate-free partition of an already prioritised item list
 * across users, in daily batches (Week 12 acceptance examples).
 *
 * - No cap: one batch, even split; the remainder goes to the LAST users, so
 *   100 items / 3 users -> 33, 33, 34.
 * - Cap N: every full batch gives each user exactly N items (20/20/20, then
 *   20/20/20). The final short batch is split evenly over the fewest users
 *   that keep each share at or below half a day's cap, so the last 20 items
 *   with cap 20 go 10/10 to two users rather than 7/7/6 to three.
 *
 * Users are taken in the given order (callers pass a stable, sorted list);
 * items are handed out in order, so the same input always yields the same plan.
 */
export function planFairAssignment(itemIds: string[], userIds: string[], dailyLimit?: number): FairBatch[] {
  const users = [...new Set(userIds)];
  if (!users.length || !itemIds.length) return [];
  if (dailyLimit !== undefined && (!Number.isInteger(dailyLimit) || dailyLimit < 1)) {
    throw new Error('dailyLimit must be a positive integer');
  }

  const batches: FairBatch[] = [];
  let cursor = 0;
  const take = (userId: string, count: number, out: FairBatch['assignments']) => {
    if (count > 0) out.push({ userId, itemIds: itemIds.slice(cursor, cursor + count) });
    cursor += count;
  };
  const evenSplit = (remaining: number, pool: string[], out: FairBatch['assignments']) => {
    const base = Math.floor(remaining / pool.length);
    const extra = remaining % pool.length;
    pool.forEach((userId, index) => take(userId, base + (index >= pool.length - extra ? 1 : 0), out));
  };

  if (dailyLimit === undefined) {
    const assignments: FairBatch['assignments'] = [];
    evenSplit(itemIds.length, users, assignments);
    return [{ batch: 1, assignments }];
  }

  const fullBatch = dailyLimit * users.length;
  while (cursor < itemIds.length) {
    const remaining = itemIds.length - cursor;
    const assignments: FairBatch['assignments'] = [];
    if (remaining >= fullBatch) {
      for (const userId of users) take(userId, dailyLimit, assignments);
    } else {
      const share = Math.max(1, Math.ceil(dailyLimit / 2));
      const pool = users.slice(0, Math.min(users.length, Math.ceil(remaining / share)));
      evenSplit(remaining, pool, assignments);
    }
    batches.push({ batch: batches.length + 1, assignments });
  }
  return batches;
}

// ---- status derivation ----------------------------------------------------

export type AssignmentFact = {
  id: string;
  itemId: string;
  assignedToId: string;
  status: 'ASSIGNED' | 'SUBMITTED' | 'CANCELLED';
  parentCountId?: string;
  countId?: string;
  createdAt: string;
};

export type CountFact = {
  id: string;
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'RECOUNT';
  createdAt: string;
};

/**
 * The count-task assignments and counts are the source of truth; a campaign
 * item's status is derived from them so it can never drift out of step with
 * what the store user and the reviewer actually did.
 */
export function deriveItemState(
  item: Pick<CampaignItemRecord, 'status' | 'lastCountedAt' | 'recounts'>,
  assignments: AssignmentFact[],
  counts: Map<string, CountFact>,
): Pick<CampaignItemRecord, 'status' | 'assignedToId' | 'assignmentId' | 'countId' | 'lastCountedAt' | 'recounts'> {
  const ordered = [...assignments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = ordered.at(-1);
  const linked = ordered.map((row) => (row.countId ? counts.get(row.countId) : undefined)).filter((row): row is CountFact => Boolean(row));
  // A verified count is what "last counted" means for prioritisation.
  const approved = linked.filter((row) => row.status === 'APPROVED').map((row) => row.createdAt).sort();
  const lastCountedAt = approved.at(-1) ?? item.lastCountedAt;
  const recounts = ordered.filter((row) => row.parentCountId).length;

  if (!latest) {
    return { status: item.status === 'EXCLUDED' ? 'EXCLUDED' : 'PENDING', lastCountedAt, recounts };
  }
  const base = { assignedToId: latest.assignedToId, assignmentId: latest.id, lastCountedAt, recounts };
  if (latest.status === 'ASSIGNED') {
    return { ...base, status: latest.parentCountId ? 'RECOUNT' : 'ASSIGNED' };
  }
  if (latest.status === 'CANCELLED') {
    return { status: item.status === 'EXCLUDED' ? 'EXCLUDED' : 'PENDING', lastCountedAt, recounts };
  }
  const count = latest.countId ? counts.get(latest.countId) : undefined;
  const countId = latest.countId;
  switch (count?.status) {
    case 'APPROVED': return { ...base, countId, status: 'APPROVED' };
    case 'REJECTED': return { ...base, countId, status: 'DISPOSITIONED' };
    case 'RECOUNT': return { ...base, countId, status: 'RECOUNT' };
    default: return { ...base, countId, status: 'SUBMITTED' };
  }
}

export type ProgressSummary = {
  total: number;
  byStatus: Record<CampaignItemStatus, number>;
  // Items that still count toward coverage (everything except EXCLUDED).
  eligible: number;
  covered: number;
  coveragePercent: number;
};

export function summarizeProgress(items: Array<Pick<CampaignItemRecord, 'status'>>): ProgressSummary {
  const byStatus = Object.fromEntries(CAMPAIGN_ITEM_STATUSES.map((status) => [status, 0])) as Record<CampaignItemStatus, number>;
  for (const item of items) byStatus[item.status] += 1;
  const eligible = items.length - byStatus.EXCLUDED;
  const covered = byStatus.APPROVED + byStatus.DISPOSITIONED;
  return { total: items.length, byStatus, eligible, covered, coveragePercent: eligible === 0 ? 100 : Math.round((covered / eligible) * 100) };
}

/**
 * Campaign status follows the work: nothing handed out yet = ACTIVE, open
 * tasks = COUNTING, everything left is awaiting review = IN_REVIEW, every
 * eligible item approved/dispositioned = COMPLETED. Draft, paused and
 * finished campaigns are left alone.
 */
export function deriveCampaignStatus(status: CampaignStatus, items: Array<Pick<CampaignItemRecord, 'status'>>): CampaignStatus {
  if (!isRunnableCampaign(status)) return status;
  const active = items.filter((item) => item.status !== 'EXCLUDED');
  if (active.every((item) => item.status === 'APPROVED' || item.status === 'DISPOSITIONED')) return 'COMPLETED';
  const started = active.some((item) => item.status !== 'PENDING');
  if (!started) return 'ACTIVE';
  const openWork = active.some((item) => item.status === 'PENDING' || item.status === 'ASSIGNED' || item.status === 'RECOUNT');
  return openWork ? 'COUNTING' : 'IN_REVIEW';
}
