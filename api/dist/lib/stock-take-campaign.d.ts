import type { AbcClass } from './abc-cycle-count.js';
export declare const CAMPAIGN_STATUSES: readonly ["DRAFT", "ACTIVE", "COUNTING", "IN_REVIEW", "COMPLETED", "PAUSED", "CANCELLED"];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export declare const CAMPAIGN_ITEM_STATUSES: readonly ["PENDING", "ASSIGNED", "SUBMITTED", "APPROVED", "RECOUNT", "DISPOSITIONED", "EXCLUDED"];
export type CampaignItemStatus = (typeof CAMPAIGN_ITEM_STATUSES)[number];
export declare const PRIORITY_KEYS: readonly ["NEVER_COUNTED", "OLDEST_COUNTED", "ABC", "EXPIRY"];
export type PriorityKey = (typeof PRIORITY_KEYS)[number];
export declare const DEFAULT_PRIORITY_ORDER: PriorityKey[];
export declare const DEFAULT_CAMPAIGN_TIMEZONE = "Asia/Kolkata";
export declare const MAX_DAILY_ITEMS_PER_USER = 500;
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
export declare function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean;
export declare function assertCampaignTransition(from: CampaignStatus, to: CampaignStatus): void;
/** Campaigns that still own work: at most one may exist per location. */
export declare function isOpenCampaign(status: CampaignStatus): boolean;
/** Campaigns the daily scheduler and item sync act on. */
export declare function isRunnableCampaign(status: CampaignStatus): boolean;
export declare function parsePriorityOrder(value: unknown): PriorityKey[];
export declare function parseDailyItemsPerUser(value: unknown): number;
export declare function isValidTimezone(timezone: string): boolean;
export declare function isDateOnly(value: unknown): value is string;
/** The calendar date (YYYY-MM-DD) `instant` falls on in `timezone`. */
export declare function localDateString(instant: Date, timezone: string): string;
/** 23:59:59 local time on `dateOnly` in `timezone`, as an ISO instant. */
export declare function endOfLocalDayIso(dateOnly: string, timezone: string): string;
export type PriorityContext = {
    abcClass?: Map<string, AbcClass>;
    nearestExpiry?: Map<string, string>;
};
/**
 * Orders campaign items by the campaign's priority chain (blueprint §12:
 * never counted -> oldest counted -> ABC/risk/expiry/value). The chain is
 * applied in the configured order; itemId is the final tie-break so the
 * same inputs always produce the same queue.
 */
export declare function prioritizeItems<T extends {
    itemId: string;
    lastCountedAt?: string;
}>(items: T[], order: PriorityKey[], context?: PriorityContext): T[];
export type AllocationInput = {
    candidates: Array<{
        itemId: string;
        avoidUserId?: string;
    }>;
    userIds: string[];
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
export declare function planDailyAllocation(input: AllocationInput): Array<{
    itemId: string;
    userId: string;
}>;
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
export declare function deriveItemState(item: Pick<CampaignItemRecord, 'status' | 'lastCountedAt' | 'recounts'>, assignments: AssignmentFact[], counts: Map<string, CountFact>): Pick<CampaignItemRecord, 'status' | 'assignedToId' | 'assignmentId' | 'countId' | 'lastCountedAt' | 'recounts'>;
export type ProgressSummary = {
    total: number;
    byStatus: Record<CampaignItemStatus, number>;
    eligible: number;
    covered: number;
    coveragePercent: number;
};
export declare function summarizeProgress(items: Array<Pick<CampaignItemRecord, 'status'>>): ProgressSummary;
/**
 * Campaign status follows the work: nothing handed out yet = ACTIVE, open
 * tasks = COUNTING, everything left is awaiting review = IN_REVIEW, every
 * eligible item approved/dispositioned = COMPLETED. Draft, paused and
 * finished campaigns are left alone.
 */
export declare function deriveCampaignStatus(status: CampaignStatus, items: Array<Pick<CampaignItemRecord, 'status'>>): CampaignStatus;
