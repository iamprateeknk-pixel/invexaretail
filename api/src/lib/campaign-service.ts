import { recordAudit } from './audit.js';
import { classifyAbcItems, aggregateLocationStock } from './abc-cycle-count.js';
import { getCampaign, listCampaignItems, listCampaigns, saveCampaign, saveCampaignItems } from './campaign-store.js';
import { persistCampaign, persistCampaignItems } from './campaign-persistence.js';
import { publishEvent } from './event-bus.js';
import { persistAudit, persistCountAssignment, persistCountAssignmentUpdate } from './persistence.js';
import {
  createCountAssignment,
  findUserById,
  listCountAssignments,
  listCounts,
  listItems,
  listLocations,
  listStockLedgerForLocation,
  updateCountAssignment,
  type CountAssignmentRecord,
} from './repository.js';
import { findUserById as findEnterpriseUserById } from './enterprise-repository.js';
import { companyOwnsLocation } from './saas/tenant-scope.js';
import {
  DEFAULT_CAMPAIGN_TIMEZONE,
  assertCampaignTransition,
  deriveCampaignStatus,
  deriveItemState,
  endOfLocalDayIso,
  isDateOnly,
  isOpenCampaign,
  isRunnableCampaign,
  isValidTimezone,
  localDateString,
  parseDailyItemsPerUser,
  parsePriorityOrder,
  planDailyAllocation,
  prioritizeItems,
  summarizeProgress,
  type AssignmentFact,
  type CampaignItemRecord,
  type CampaignRecord,
  type CampaignStatus,
  type CountFact,
} from './stock-take-campaign.js';

export type CampaignActor = { id: string; role: string };

export class CampaignError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const newId = () => `camp-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

function announce(campaign: CampaignRecord): void {
  publishEvent({ topic: 'campaign.changed', companyId: campaign.companyId, locationIds: [campaign.locationId] });
  publishEvent({ topic: 'assignment.changed', companyId: campaign.companyId, locationIds: [campaign.locationId] });
}

async function audit(actor: CampaignActor, action: string, campaign: CampaignRecord, metadata: Record<string, unknown> = {}): Promise<void> {
  await persistAudit(recordAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action,
    entityType: 'StockTakeCampaign',
    entityId: campaign.id,
    metadata: { name: campaign.name, locationId: campaign.locationId, ...metadata },
  }));
}

// ---- validation -----------------------------------------------------------

/** A Store User who can be given campaign work at this location, or an explanation of why not. */
export function checkCampaignUser(userId: string, locationId: string, companyId: string): string | null {
  const user = findUserById(userId);
  if (!user || user.role !== 'STORE_USER') return `${userId} is not a Store User.`;
  if (!user.assignedLocationIds.includes(locationId)) return `${user.name} is not assigned to this location.`;
  const enterprise = findEnterpriseUserById(userId);
  if (enterprise && (enterprise.status !== 'active' || enterprise.companyId !== companyId)) return `${user.name} is not an active user of this company.`;
  return null;
}

function parseUserIds(value: unknown, locationId: string, companyId: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new CampaignError('Select at least one Store User for the campaign.');
  const userIds = [...new Set(value.map(String))];
  for (const userId of userIds) {
    const problem = checkCampaignUser(userId, locationId, companyId);
    if (problem) throw new CampaignError(problem);
  }
  return userIds;
}

function requireCampaign(id: string, companyId: string): CampaignRecord {
  const campaign = getCampaign(id);
  if (!campaign || campaign.companyId !== companyId) throw new CampaignError('Campaign was not found.', 404);
  return campaign;
}

// ---- eligibility ----------------------------------------------------------

type Eligible = {
  itemIds: Set<string>;
  abc: Map<string, 'A' | 'B' | 'C'>;
  nearestExpiry: Map<string, string>;
};

/** Current positive-stock items at the branch (zero stock is never eligible). */
function eligibleAt(locationId: string): Eligible {
  const ledger = listStockLedgerForLocation(locationId);
  const aggregated = aggregateLocationStock(listItems(), ledger);
  const abc = new Map([...classifyAbcItems(aggregated).entries()].map(([itemId, value]) => [itemId, value.abcClass]));
  const positiveLots = new Set(ledger.filter((row) => row.onHand > 0).map((row) => row.lotId));
  const nearestExpiry = new Map<string, string>();
  for (const item of listItems()) {
    for (const lot of item.lots) {
      if (!lot.expiryDate || !positiveLots.has(lot.id)) continue;
      const current = nearestExpiry.get(item.id);
      if (!current || lot.expiryDate < current) nearestExpiry.set(item.id, lot.expiryDate);
    }
  }
  return { itemIds: new Set(aggregated.map((row) => row.itemId)), abc, nearestExpiry };
}

/** When each item at the branch was last verified by an approved count. */
function lastApprovedCountAt(locationId: string): Map<string, string> {
  const latest = new Map<string, string>();
  for (const count of listCounts()) {
    if (count.locationId !== locationId || count.status !== 'APPROVED') continue;
    const current = latest.get(count.itemId);
    if (!current || count.createdAt > current) latest.set(count.itemId, count.createdAt);
  }
  return latest;
}

function newItem(campaignId: string, itemId: string, lastCountedAt: string | undefined, nowIso: string): CampaignItemRecord {
  return { campaignId, itemId, status: 'PENDING', lastCountedAt, recounts: 0, addedAt: nowIso, updatedAt: nowIso };
}

// ---- reconcile ------------------------------------------------------------

function assignmentFacts(campaignId: string): Map<string, AssignmentFact[]> {
  const byItem = new Map<string, AssignmentFact[]>();
  for (const row of listCountAssignments()) {
    if (row.campaignId !== campaignId) continue;
    const list = byItem.get(row.itemId) ?? [];
    list.push({ id: row.id, itemId: row.itemId, assignedToId: row.assignedToId, status: row.status, parentCountId: row.parentCountId, countId: row.countId, createdAt: row.createdAt });
    byItem.set(row.itemId, list);
  }
  return byItem;
}

/**
 * Brings every campaign item (and the campaign's own status) in line with the
 * count-task assignments and counts, which are the source of truth. Called
 * after any count activity and at every scheduler run, so coverage can never
 * drift from what actually happened.
 */
export async function reconcileCampaign(campaignId: string): Promise<CampaignRecord | undefined> {
  const campaign = getCampaign(campaignId);
  if (!campaign) return undefined;
  const facts = assignmentFacts(campaignId);
  const counts = new Map<string, CountFact>(listCounts().map((count) => [count.id, { id: count.id, status: count.status, createdAt: count.createdAt }]));
  const now = new Date().toISOString();
  const changed: CampaignItemRecord[] = [];
  const items = listCampaignItems(campaignId).map((item) => {
    const next = deriveItemState(item, facts.get(item.itemId) ?? [], counts);
    const same = next.status === item.status && next.assignmentId === item.assignmentId && next.assignedToId === item.assignedToId
      && next.countId === item.countId && next.lastCountedAt === item.lastCountedAt && next.recounts === item.recounts;
    if (same) return item;
    // Spread first, then set the task links explicitly so a cancelled task
    // clears them instead of leaving a stale assignee behind.
    const updated: CampaignItemRecord = {
      ...item,
      status: next.status,
      assignedToId: next.assignedToId,
      assignmentId: next.assignmentId,
      countId: next.countId,
      lastCountedAt: next.lastCountedAt,
      recounts: next.recounts,
      updatedAt: now,
    };
    changed.push(updated);
    return updated;
  });
  if (changed.length) {
    saveCampaignItems(changed);
    await persistCampaignItems(changed);
  }
  const nextStatus = deriveCampaignStatus(campaign.status, items);
  if (nextStatus !== campaign.status) {
    const next: CampaignRecord = { ...campaign, status: nextStatus, updatedAt: now, ...(nextStatus === 'COMPLETED' ? { completedAt: now } : {}) };
    saveCampaign(next);
    await persistCampaign(next);
    announce(next);
    return next;
  }
  if (changed.length) announce(campaign);
  return campaign;
}

/** Never lets a campaign bookkeeping failure break the count flow that triggered it. */
export async function reconcileCampaignQuietly(campaignId: string | undefined): Promise<void> {
  if (!campaignId) return;
  try {
    await reconcileCampaign(campaignId);
  } catch (error) {
    console.warn('Campaign reconcile failed', campaignId, error instanceof Error ? error.message : error);
  }
}

// ---- lifecycle ------------------------------------------------------------

export async function createCampaign(input: Record<string, unknown>, actor: CampaignActor, companyId: string, now = new Date()): Promise<CampaignRecord> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2 || name.length > 120) throw new CampaignError('A campaign name of 2-120 characters is required.');
  const locationId = typeof input.locationId === 'string' ? input.locationId : '';
  if (!listLocations().some((location) => location.id === locationId) || !companyOwnsLocation(companyId, locationId)) {
    throw new CampaignError('Select a valid location.');
  }
  const timezone = typeof input.timezone === 'string' && input.timezone ? input.timezone : DEFAULT_CAMPAIGN_TIMEZONE;
  if (!isValidTimezone(timezone)) throw new CampaignError('timezone is not a valid IANA timezone.');
  const startDate = input.startDate === undefined ? localDateString(now, timezone) : input.startDate;
  if (!isDateOnly(startDate)) throw new CampaignError('startDate must be a YYYY-MM-DD date.');
  const endDate = input.endDate === undefined || input.endDate === null || input.endDate === '' ? undefined : input.endDate;
  if (endDate !== undefined && (!isDateOnly(endDate) || endDate < startDate)) throw new CampaignError('endDate must be a YYYY-MM-DD date on or after startDate.');

  let dailyItemsPerUser: number;
  let priorityOrder;
  try {
    dailyItemsPerUser = parseDailyItemsPerUser(input.dailyItemsPerUser);
    priorityOrder = parsePriorityOrder(input.priorityOrder);
  } catch (error) {
    throw new CampaignError(error instanceof Error ? error.message : 'Invalid campaign settings.');
  }
  const userIds = parseUserIds(input.userIds, locationId, companyId);

  // One open campaign per branch: two would hand the same items to people twice.
  const clash = listCampaigns(companyId).find((row) => row.locationId === locationId && isOpenCampaign(row.status));
  if (clash) throw new CampaignError(`"${clash.name}" is already open for this location. Complete or cancel it first.`, 409);

  const nowIso = now.toISOString();
  const campaign = saveCampaign({
    id: newId(), companyId, name, locationId, status: 'DRAFT', dailyItemsPerUser, userIds, priorityOrder,
    includeNewStock: input.includeNewStock === undefined ? true : Boolean(input.includeNewStock),
    timezone, startDate, endDate: endDate === undefined ? undefined : String(endDate), createdById: actor.id, createdAt: nowIso, updatedAt: nowIso,
  });
  await persistCampaign(campaign);
  await audit(actor, 'CAMPAIGN_CREATED', campaign, { dailyItemsPerUser, userIds });
  announce(campaign);
  return campaign;
}

/** Adds newly stocked items, drops stockouts still in the queue, and restores items that came back. */
async function syncQueue(campaign: CampaignRecord, eligible: Eligible, nowIso: string): Promise<{ added: number; excluded: number; restored: number }> {
  const existing = new Map(listCampaignItems(campaign.id).map((row) => [row.itemId, row]));
  const history = lastApprovedCountAt(campaign.locationId);
  const changed: CampaignItemRecord[] = [];
  let added = 0;
  let excluded = 0;
  let restored = 0;
  for (const item of existing.values()) {
    if (item.status === 'PENDING' && !eligible.itemIds.has(item.itemId)) {
      changed.push({ ...item, status: 'EXCLUDED', excludedReason: 'ZERO_STOCK', updatedAt: nowIso });
      excluded += 1;
    } else if (item.status === 'EXCLUDED' && item.excludedReason === 'ZERO_STOCK' && eligible.itemIds.has(item.itemId)) {
      changed.push({ ...item, status: 'PENDING', excludedReason: undefined, updatedAt: nowIso });
      restored += 1;
    }
  }
  if (campaign.includeNewStock) {
    for (const itemId of eligible.itemIds) {
      if (existing.has(itemId)) continue;
      changed.push(newItem(campaign.id, itemId, history.get(itemId), nowIso));
      added += 1;
    }
  }
  if (changed.length) {
    saveCampaignItems(changed);
    await persistCampaignItems(changed);
  }
  return { added, excluded, restored };
}

export async function activateCampaign(id: string, actor: CampaignActor, companyId: string, now = new Date()): Promise<{ campaign: CampaignRecord; run: RunResult }> {
  const campaign = requireCampaign(id, companyId);
  try {
    assertCampaignTransition(campaign.status, 'ACTIVE');
  } catch (error) {
    throw new CampaignError(error instanceof Error ? error.message : 'Cannot activate this campaign.', 409);
  }
  if (campaign.status !== 'DRAFT') throw new CampaignError('Only a draft campaign can be activated.', 409);

  const nowIso = now.toISOString();
  const eligible = eligibleAt(campaign.locationId);
  const history = lastApprovedCountAt(campaign.locationId);
  const rows = [...eligible.itemIds].map((itemId) => newItem(campaign.id, itemId, history.get(itemId), nowIso));
  saveCampaignItems(rows);
  await persistCampaignItems(rows);
  const active = saveCampaign({ ...campaign, status: 'ACTIVE', activatedAt: nowIso, updatedAt: nowIso });
  await persistCampaign(active);
  await audit(actor, 'CAMPAIGN_ACTIVATED', active, { eligibleItems: rows.length });
  announce(active);
  const run = await runCampaignDay(id, companyId, { now, actor });
  return { campaign: getCampaign(id)!, run };
}

export async function pauseCampaign(id: string, actor: CampaignActor, companyId: string): Promise<CampaignRecord> {
  const campaign = requireCampaign(id, companyId);
  if (!isRunnableCampaign(campaign.status)) throw new CampaignError('Only a running campaign can be paused.', 409);
  const paused = saveCampaign({ ...campaign, status: 'PAUSED', pausedFrom: campaign.status, updatedAt: new Date().toISOString() });
  await persistCampaign(paused);
  await audit(actor, 'CAMPAIGN_PAUSED', paused);
  announce(paused);
  return paused;
}

export async function resumeCampaign(id: string, actor: CampaignActor, companyId: string): Promise<CampaignRecord> {
  const campaign = requireCampaign(id, companyId);
  if (campaign.status !== 'PAUSED') throw new CampaignError('Only a paused campaign can be resumed.', 409);
  const resumed = saveCampaign({ ...campaign, status: campaign.pausedFrom ?? 'ACTIVE', pausedFrom: undefined, updatedAt: new Date().toISOString() });
  await persistCampaign(resumed);
  await audit(actor, 'CAMPAIGN_RESUMED', resumed);
  const settled = await reconcileCampaign(id);
  announce(resumed);
  return settled ?? resumed;
}

async function cancelOpenAssignments(campaignId: string, onlyUserId?: string): Promise<CountAssignmentRecord[]> {
  const open = listCountAssignments().filter((row) => row.campaignId === campaignId && row.status === 'ASSIGNED' && (!onlyUserId || row.assignedToId === onlyUserId));
  const cancelled: CountAssignmentRecord[] = [];
  for (const row of open) {
    const updated = updateCountAssignment(row.id, { status: 'CANCELLED' });
    await persistCountAssignmentUpdate(updated);
    cancelled.push(updated);
  }
  return cancelled;
}

export async function cancelCampaign(id: string, actor: CampaignActor, companyId: string): Promise<CampaignRecord> {
  const campaign = requireCampaign(id, companyId);
  if (!isOpenCampaign(campaign.status)) throw new CampaignError(`This campaign is already ${campaign.status.toLowerCase()}.`, 409);
  const cancelled = await cancelOpenAssignments(id);
  const nowIso = new Date().toISOString();
  const closed = saveCampaign({ ...campaign, status: 'CANCELLED', pausedFrom: undefined, cancelledAt: nowIso, updatedAt: nowIso });
  await persistCampaign(closed);
  await audit(actor, 'CAMPAIGN_CANCELLED', closed, { cancelledAssignments: cancelled.length });
  announce(closed);
  return closed;
}

export async function updateCampaign(id: string, patch: Record<string, unknown>, actor: CampaignActor, companyId: string): Promise<CampaignRecord> {
  const campaign = requireCampaign(id, companyId);
  if (!isOpenCampaign(campaign.status)) throw new CampaignError('A finished campaign cannot be edited.', 409);
  const next: CampaignRecord = { ...campaign };
  try {
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (name.length < 2 || name.length > 120) throw new CampaignError('A campaign name of 2-120 characters is required.');
      next.name = name;
    }
    if (patch.dailyItemsPerUser !== undefined) next.dailyItemsPerUser = parseDailyItemsPerUser(patch.dailyItemsPerUser);
    if (patch.priorityOrder !== undefined) next.priorityOrder = parsePriorityOrder(patch.priorityOrder);
    if (patch.includeNewStock !== undefined) next.includeNewStock = Boolean(patch.includeNewStock);
    if (patch.endDate !== undefined) {
      const endDate = patch.endDate;
      if (endDate === null || endDate === '') next.endDate = undefined;
      else if (isDateOnly(endDate) && endDate >= campaign.startDate) next.endDate = endDate;
      else throw new CampaignError('endDate must be a YYYY-MM-DD date on or after startDate.');
    }
  } catch (error) {
    if (error instanceof CampaignError) throw error;
    throw new CampaignError(error instanceof Error ? error.message : 'Invalid campaign settings.');
  }
  let removed: string[] = [];
  if (patch.userIds !== undefined) {
    next.userIds = parseUserIds(patch.userIds, campaign.locationId, companyId);
    removed = campaign.userIds.filter((userId) => !next.userIds.includes(userId));
  }
  next.updatedAt = new Date().toISOString();
  const saved = saveCampaign(next);
  await persistCampaign(saved);
  // A user taken off the campaign must not keep hidden open work: hand it back to the queue.
  for (const userId of removed) await cancelOpenAssignments(id, userId);
  await reconcileCampaign(id);
  await audit(actor, 'CAMPAIGN_UPDATED', saved, { fields: Object.keys(patch), removedUsers: removed });
  announce(saved);
  return getCampaign(id)!;
}

/**
 * Absence handling (blueprint §12): an admin moves a user's unfinished work
 * to someone else, or - with no target - returns it to the queue so it is
 * redistributed, without losing campaign coverage.
 */
export async function reassignWorkload(
  id: string,
  input: { fromUserId?: unknown; toUserId?: unknown },
  actor: CampaignActor,
  companyId: string,
  now = new Date(),
): Promise<{ moved: number; returnedToQueue: number }> {
  const campaign = requireCampaign(id, companyId);
  if (!isOpenCampaign(campaign.status)) throw new CampaignError('A finished campaign cannot be reassigned.', 409);
  const fromUserId = typeof input.fromUserId === 'string' ? input.fromUserId : '';
  if (!fromUserId) throw new CampaignError('fromUserId is required.');
  const toUserId = typeof input.toUserId === 'string' && input.toUserId ? input.toUserId : undefined;

  const open = listCountAssignments().filter((row) => row.campaignId === id && row.status === 'ASSIGNED' && row.assignedToId === fromUserId);
  if (!open.length) return { moved: 0, returnedToQueue: 0 };

  if (toUserId) {
    if (toUserId === fromUserId) throw new CampaignError('Choose a different user to receive the work.');
    const problem = checkCampaignUser(toUserId, campaign.locationId, companyId);
    if (problem) throw new CampaignError(problem);
    for (const row of open) {
      await persistCountAssignmentUpdate(updateCountAssignment(row.id, { assignedToId: toUserId }));
    }
    if (!campaign.userIds.includes(toUserId)) {
      const widened = saveCampaign({ ...campaign, userIds: [...campaign.userIds, toUserId], updatedAt: now.toISOString() });
      await persistCampaign(widened);
    }
    await reconcileCampaign(id);
    await audit(actor, 'CAMPAIGN_WORKLOAD_REASSIGNED', campaign, { fromUserId, toUserId, moved: open.length });
    announce(campaign);
    return { moved: open.length, returnedToQueue: 0 };
  }

  const remaining = campaign.userIds.filter((userId) => userId !== fromUserId);
  if (remaining.length === 0) throw new CampaignError('That is the only user on the campaign - choose someone to receive the work.');
  await cancelOpenAssignments(id, fromUserId);
  const saved = saveCampaign({ ...campaign, userIds: remaining, updatedAt: now.toISOString() });
  await persistCampaign(saved);
  await reconcileCampaign(id);
  await audit(actor, 'CAMPAIGN_WORKLOAD_RETURNED', saved, { fromUserId, returnedToQueue: open.length });
  // Redistribute right away where the remaining users have room; the rest rolls over.
  await runCampaignDay(id, companyId, { now, force: true, actor });
  return { moved: 0, returnedToQueue: open.length };
}

// ---- daily allocation -----------------------------------------------------

export type RunResult = {
  ran: boolean;
  skipped?: 'NOT_RUNNABLE' | 'NOT_STARTED' | 'ENDED' | 'ALREADY_RAN' | 'NO_ACTIVE_USERS';
  date?: string;
  assigned: number;
  perUser: Record<string, number>;
  queue: { added: number; excluded: number; restored: number };
};

const emptyRun = (skipped?: RunResult['skipped']): RunResult => ({ ran: false, skipped, assigned: 0, perUser: {}, queue: { added: 0, excluded: 0, restored: 0 } });

/**
 * One day's automatic allocation: reconcile, refresh the queue against current
 * stock, then top every active user up to DailyItemsPerUser open tasks in
 * priority order. Unfinished work rolls over (it counts toward the quota, so
 * nothing is duplicated). Safe to call repeatedly - a date that already ran
 * is skipped unless forced.
 */
export async function runCampaignDay(
  id: string,
  companyId: string,
  options: { now?: Date; force?: boolean; actor?: CampaignActor } = {},
): Promise<RunResult> {
  const now = options.now ?? new Date();
  let campaign = requireCampaign(id, companyId);
  campaign = (await reconcileCampaign(id)) ?? campaign;
  if (!isRunnableCampaign(campaign.status)) return emptyRun('NOT_RUNNABLE');
  const today = localDateString(now, campaign.timezone);
  if (today < campaign.startDate) return emptyRun('NOT_STARTED');
  if (campaign.endDate && today > campaign.endDate) return { ...emptyRun('ENDED'), date: today };
  if (campaign.lastRunDate === today && !options.force) return { ...emptyRun('ALREADY_RAN'), date: today };

  const users = campaign.userIds.filter((userId) => checkCampaignUser(userId, campaign.locationId, campaign.companyId) === null);
  if (!users.length) return { ...emptyRun('NO_ACTIVE_USERS'), date: today };

  const nowIso = now.toISOString();
  const eligible = eligibleAt(campaign.locationId);
  const queue = await syncQueue(campaign, eligible, nowIso);
  const items = listCampaignItems(id);

  const openLoad = new Map<string, number>();
  for (const row of listCountAssignments()) {
    if (row.campaignId === id && row.status === 'ASSIGNED') openLoad.set(row.assignedToId, (openLoad.get(row.assignedToId) ?? 0) + 1);
  }
  const waiting = items.filter((item) => item.status === 'PENDING' || (item.status === 'RECOUNT' && !openAssignmentFor(id, item.itemId)));
  const ordered = prioritizeItems(waiting, campaign.priorityOrder, { abcClass: eligible.abc, nearestExpiry: eligible.nearestExpiry });
  const plan = planDailyAllocation({
    candidates: ordered.map((item) => ({ itemId: item.itemId, avoidUserId: item.status === 'RECOUNT' ? item.assignedToId : undefined })),
    userIds: users,
    openLoad,
    dailyItemsPerUser: campaign.dailyItemsPerUser,
  });

  const dueDate = endOfLocalDayIso(today, campaign.timezone);
  const byUser = new Map<string, string[]>();
  for (const { itemId, userId } of plan) byUser.set(userId, [...(byUser.get(userId) ?? []), itemId]);
  const itemById = new Map(items.map((item) => [item.itemId, item]));
  const changed: CampaignItemRecord[] = [];
  const perUser: Record<string, number> = {};

  for (const [userId, itemIds] of byUser) {
    // One shared countDate per user per run: the mobile app groups by it, so
    // each user's day shows up as its own stock count.
    const countDate = nowIso;
    const created = itemIds.map((itemId) => {
      const previous = itemById.get(itemId)!;
      return createCountAssignment({
        id: `assign-${Math.random().toString(36).slice(2, 10)}`,
        locationId: campaign.locationId,
        itemId,
        assignedToId: userId,
        assignedById: campaign.createdById,
        countDate,
        dueDate,
        priority: previous.status === 'RECOUNT' ? 'HIGH' : 'NORMAL',
        instructions: `Stock-take campaign "${campaign.name}" - ${today}`,
        campaignId: id,
      });
    });
    await Promise.all(created.map((assignment) => persistCountAssignment(assignment)));
    perUser[userId] = created.length;
    for (const assignment of created) {
      const previous = itemById.get(assignment.itemId)!;
      changed.push({
        ...previous,
        status: previous.status === 'RECOUNT' ? 'RECOUNT' : 'ASSIGNED',
        assignedToId: userId,
        assignmentId: assignment.id,
        assignedDate: nowIso,
        updatedAt: nowIso,
      });
    }
  }
  if (changed.length) {
    saveCampaignItems(changed);
    await persistCampaignItems(changed);
  }

  const ran = saveCampaign({ ...getCampaign(id)!, lastRunDate: today, updatedAt: nowIso });
  await persistCampaign(ran);
  const settled = (await reconcileCampaign(id)) ?? ran;
  if (options.actor || plan.length) {
    await audit(options.actor ?? { id: 'system', role: 'SYSTEM' }, 'CAMPAIGN_DAILY_ALLOCATION', settled, {
      date: today, assigned: plan.length, perUser, ...queue,
    });
  }
  if (plan.length) announce(settled);
  return { ran: true, date: today, assigned: plan.length, perUser, queue };
}

function openAssignmentFor(campaignId: string, itemId: string): boolean {
  return listCountAssignments().some((row) => row.campaignId === campaignId && row.itemId === itemId && row.status === 'ASSIGNED');
}

/** Scheduler entry point: every running campaign, every company. Errors are isolated per campaign. */
export async function runDueCampaigns(now = new Date()): Promise<Array<{ campaignId: string; result?: RunResult; error?: string }>> {
  const results: Array<{ campaignId: string; result?: RunResult; error?: string }> = [];
  for (const campaign of listCampaigns()) {
    if (!isRunnableCampaign(campaign.status)) continue;
    try {
      results.push({ campaignId: campaign.id, result: await runCampaignDay(campaign.id, campaign.companyId, { now }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('Campaign run failed', campaign.id, message);
      results.push({ campaignId: campaign.id, error: message });
    }
  }
  return results;
}

// ---- read models ----------------------------------------------------------

export type UserWorkload = { userId: string; name: string; open: number; submitted: number; approved: number; recount: number; available: boolean };

export async function campaignDetail(id: string, companyId: string) {
  requireCampaign(id, companyId);
  const campaign = (await reconcileCampaign(id)) ?? getCampaign(id)!;
  const items = listCampaignItems(id);
  const userIds = new Set([...campaign.userIds, ...items.map((item) => item.assignedToId).filter((value): value is string => Boolean(value))]);
  const workload: UserWorkload[] = [...userIds].map((userId) => {
    const mine = items.filter((item) => item.assignedToId === userId);
    return {
      userId,
      name: findUserById(userId)?.name ?? userId,
      open: mine.filter((item) => item.status === 'ASSIGNED').length,
      submitted: mine.filter((item) => item.status === 'SUBMITTED').length,
      approved: mine.filter((item) => item.status === 'APPROVED' || item.status === 'DISPOSITIONED').length,
      recount: mine.filter((item) => item.status === 'RECOUNT').length,
      available: campaign.userIds.includes(userId) && checkCampaignUser(userId, campaign.locationId, campaign.companyId) === null,
    };
  });
  return { campaign, progress: summarizeProgress(items), workload };
}

export function campaignItemsView(id: string, companyId: string, status?: string, limit = 200, offset = 0) {
  requireCampaign(id, companyId);
  const catalog = new Map(listItems().map((item) => [item.id, item]));
  const rows = listCampaignItems(id)
    .filter((item) => !status || item.status === status.toUpperCase())
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  return {
    total: rows.length,
    items: rows.slice(offset, offset + limit).map((row) => ({
      ...row,
      itemCode: catalog.get(row.itemId)?.code,
      itemName: catalog.get(row.itemId)?.name ?? row.itemId,
      assignedToName: row.assignedToId ? findUserById(row.assignedToId)?.name ?? row.assignedToId : undefined,
    })),
  };
}

export function listCampaignSummaries(companyId: string, allowedLocationIds: string[] | null) {
  return listCampaigns(companyId)
    .filter((campaign) => allowedLocationIds === null || allowedLocationIds.includes(campaign.locationId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((campaign) => ({ ...campaign, progress: summarizeProgress(listCampaignItems(campaign.id)) }));
}

export type { CampaignStatus };
