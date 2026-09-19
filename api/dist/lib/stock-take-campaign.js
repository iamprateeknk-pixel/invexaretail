"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DAILY_ITEMS_PER_USER = exports.DEFAULT_CAMPAIGN_TIMEZONE = exports.DEFAULT_PRIORITY_ORDER = exports.PRIORITY_KEYS = exports.CAMPAIGN_ITEM_STATUSES = exports.CAMPAIGN_STATUSES = void 0;
exports.canTransitionCampaign = canTransitionCampaign;
exports.assertCampaignTransition = assertCampaignTransition;
exports.isOpenCampaign = isOpenCampaign;
exports.isRunnableCampaign = isRunnableCampaign;
exports.parsePriorityOrder = parsePriorityOrder;
exports.parseDailyItemsPerUser = parseDailyItemsPerUser;
exports.isValidTimezone = isValidTimezone;
exports.isDateOnly = isDateOnly;
exports.localDateString = localDateString;
exports.endOfLocalDayIso = endOfLocalDayIso;
exports.prioritizeItems = prioritizeItems;
exports.planDailyAllocation = planDailyAllocation;
exports.deriveItemState = deriveItemState;
exports.summarizeProgress = summarizeProgress;
exports.deriveCampaignStatus = deriveCampaignStatus;
// Blueprint v4 §12-14 / Appendix A: a monthly stock-take campaign replaces
// item-by-item manual assignment. The pure rules live here (state machine,
// prioritisation, balanced allocation, status derivation); lib/campaign-
// service.ts wires them to the repository, scheduler and persistence.
exports.CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'COUNTING', 'IN_REVIEW', 'COMPLETED', 'PAUSED', 'CANCELLED'];
// PENDING = in the queue, not yet handed to anyone.
// ASSIGNED / SUBMITTED / RECOUNT mirror the count-task flow; APPROVED and
// DISPOSITIONED (review rejected the count) are terminal "covered" states.
// EXCLUDED = left out of coverage (e.g. stock fell to zero before counting).
exports.CAMPAIGN_ITEM_STATUSES = ['PENDING', 'ASSIGNED', 'SUBMITTED', 'APPROVED', 'RECOUNT', 'DISPOSITIONED', 'EXCLUDED'];
exports.PRIORITY_KEYS = ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY'];
exports.DEFAULT_PRIORITY_ORDER = ['NEVER_COUNTED', 'OLDEST_COUNTED', 'ABC', 'EXPIRY'];
exports.DEFAULT_CAMPAIGN_TIMEZONE = 'Asia/Kolkata';
exports.MAX_DAILY_ITEMS_PER_USER = 500;
// ---- state machine --------------------------------------------------------
const TRANSITIONS = {
    DRAFT: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['COUNTING', 'IN_REVIEW', 'COMPLETED', 'PAUSED', 'CANCELLED'],
    COUNTING: ['ACTIVE', 'IN_REVIEW', 'COMPLETED', 'PAUSED', 'CANCELLED'],
    IN_REVIEW: ['ACTIVE', 'COUNTING', 'COMPLETED', 'PAUSED', 'CANCELLED'],
    PAUSED: ['ACTIVE', 'COUNTING', 'IN_REVIEW', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};
function canTransitionCampaign(from, to) {
    return from === to || TRANSITIONS[from].includes(to);
}
function assertCampaignTransition(from, to) {
    if (!canTransitionCampaign(from, to)) {
        throw new Error(`A ${from.toLowerCase().replace('_', ' ')} campaign cannot move to ${to.toLowerCase().replace('_', ' ')}.`);
    }
}
/** Campaigns that still own work: at most one may exist per location. */
function isOpenCampaign(status) {
    return status !== 'COMPLETED' && status !== 'CANCELLED';
}
/** Campaigns the daily scheduler and item sync act on. */
function isRunnableCampaign(status) {
    return status === 'ACTIVE' || status === 'COUNTING' || status === 'IN_REVIEW';
}
// ---- input parsing --------------------------------------------------------
function parsePriorityOrder(value) {
    if (value === undefined || value === null)
        return [...exports.DEFAULT_PRIORITY_ORDER];
    if (!Array.isArray(value) || value.length === 0)
        throw new Error('priorityOrder must be a non-empty list.');
    const seen = new Set();
    for (const entry of value) {
        const key = String(entry).trim().toUpperCase();
        if (!exports.PRIORITY_KEYS.includes(key)) {
            throw new Error(`priorityOrder entries must be one of ${exports.PRIORITY_KEYS.join(', ')}.`);
        }
        seen.add(key);
    }
    return [...seen];
}
function parseDailyItemsPerUser(value) {
    const quota = Number(value);
    if (!Number.isInteger(quota) || quota < 1 || quota > exports.MAX_DAILY_ITEMS_PER_USER) {
        throw new Error(`dailyItemsPerUser must be a whole number between 1 and ${exports.MAX_DAILY_ITEMS_PER_USER}.`);
    }
    return quota;
}
function isValidTimezone(timezone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
    }
    catch {
        return false;
    }
}
function isDateOnly(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
// ---- local calendar -------------------------------------------------------
/** The calendar date (YYYY-MM-DD) `instant` falls on in `timezone`. */
function localDateString(instant, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
}
function timezoneOffsetMs(instant, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant);
    const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
    return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
/** 23:59:59 local time on `dateOnly` in `timezone`, as an ISO instant. */
function endOfLocalDayIso(dateOnly, timezone) {
    const [year, month, day] = dateOnly.split('-').map(Number);
    const guess = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
    return new Date(guess.getTime() - timezoneOffsetMs(guess, timezone)).toISOString();
}
const ABC_RANK = { A: 0, B: 1, C: 2 };
/**
 * Orders campaign items by the campaign's priority chain (blueprint §12:
 * never counted -> oldest counted -> ABC/risk/expiry/value). The chain is
 * applied in the configured order; itemId is the final tie-break so the
 * same inputs always produce the same queue.
 */
function prioritizeItems(items, order, context = {}) {
    const compare = (left, right) => {
        for (const key of order) {
            let delta = 0;
            if (key === 'NEVER_COUNTED') {
                delta = Number(Boolean(left.lastCountedAt)) - Number(Boolean(right.lastCountedAt));
            }
            else if (key === 'OLDEST_COUNTED') {
                if (left.lastCountedAt && right.lastCountedAt)
                    delta = left.lastCountedAt.localeCompare(right.lastCountedAt);
            }
            else if (key === 'ABC') {
                delta = ABC_RANK[context.abcClass?.get(left.itemId) ?? 'C'] - ABC_RANK[context.abcClass?.get(right.itemId) ?? 'C'];
            }
            else if (key === 'EXPIRY') {
                const l = context.nearestExpiry?.get(left.itemId);
                const r = context.nearestExpiry?.get(right.itemId);
                if (l && r)
                    delta = l.localeCompare(r);
                else if (l || r)
                    delta = l ? -1 : 1;
            }
            if (delta !== 0)
                return delta;
        }
        return left.itemId.localeCompare(right.itemId);
    };
    return [...items].sort(compare);
}
/**
 * Tops every user up to `dailyItemsPerUser` open tasks, handing out the
 * highest-priority items first and always to the least-loaded user, so work
 * stays balanced. Unfinished tasks count toward the quota (rollover without
 * duplication). A recount avoids the user who did the original count when
 * anyone else has capacity.
 */
function planDailyAllocation(input) {
    const load = new Map(input.userIds.map((userId) => [userId, input.openLoad.get(userId) ?? 0]));
    const order = new Map(input.userIds.map((userId, index) => [userId, index]));
    const withCapacity = () => input.userIds.filter((userId) => (load.get(userId) ?? 0) < input.dailyItemsPerUser);
    const plan = [];
    for (const candidate of input.candidates) {
        let pool = withCapacity();
        if (!pool.length)
            break;
        if (candidate.avoidUserId) {
            const others = pool.filter((userId) => userId !== candidate.avoidUserId);
            if (others.length)
                pool = others;
        }
        pool.sort((a, b) => (load.get(a) - load.get(b)) || (order.get(a) - order.get(b)));
        const userId = pool[0];
        load.set(userId, load.get(userId) + 1);
        plan.push({ itemId: candidate.itemId, userId });
    }
    return plan;
}
/**
 * The count-task assignments and counts are the source of truth; a campaign
 * item's status is derived from them so it can never drift out of step with
 * what the store user and the reviewer actually did.
 */
function deriveItemState(item, assignments, counts) {
    const ordered = [...assignments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = ordered.at(-1);
    const linked = ordered.map((row) => (row.countId ? counts.get(row.countId) : undefined)).filter((row) => Boolean(row));
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
function summarizeProgress(items) {
    const byStatus = Object.fromEntries(exports.CAMPAIGN_ITEM_STATUSES.map((status) => [status, 0]));
    for (const item of items)
        byStatus[item.status] += 1;
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
function deriveCampaignStatus(status, items) {
    if (!isRunnableCampaign(status))
        return status;
    const active = items.filter((item) => item.status !== 'EXCLUDED');
    if (active.every((item) => item.status === 'APPROVED' || item.status === 'DISPOSITIONED'))
        return 'COMPLETED';
    const started = active.some((item) => item.status !== 'PENDING');
    if (!started)
        return 'ACTIVE';
    const openWork = active.some((item) => item.status === 'PENDING' || item.status === 'ASSIGNED' || item.status === 'RECOUNT');
    return openWork ? 'COUNTING' : 'IN_REVIEW';
}
