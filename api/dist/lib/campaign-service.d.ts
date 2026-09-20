import { type CampaignRecord, type CampaignStatus } from './stock-take-campaign.js';
export type CampaignActor = {
    id: string;
    role: string;
};
export declare class CampaignError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
/** A count worker who can be given campaign work at this location, or an explanation of why not. */
export declare function checkCampaignUser(userId: string, locationId: string, companyId: string): string | null;
/**
 * Brings every campaign item (and the campaign's own status) in line with the
 * count-task assignments and counts, which are the source of truth. Called
 * after any count activity and at every scheduler run, so coverage can never
 * drift from what actually happened.
 */
export declare function reconcileCampaign(campaignId: string): Promise<CampaignRecord | undefined>;
/** Never lets a campaign bookkeeping failure break the count flow that triggered it. */
export declare function reconcileCampaignQuietly(campaignId: string | undefined): Promise<void>;
export declare function createCampaign(input: Record<string, unknown>, actor: CampaignActor, companyId: string, now?: Date): Promise<CampaignRecord>;
export declare function activateCampaign(id: string, actor: CampaignActor, companyId: string, now?: Date): Promise<{
    campaign: CampaignRecord;
    run: RunResult;
}>;
export declare function pauseCampaign(id: string, actor: CampaignActor, companyId: string): Promise<CampaignRecord>;
export declare function resumeCampaign(id: string, actor: CampaignActor, companyId: string): Promise<CampaignRecord>;
export declare function cancelCampaign(id: string, actor: CampaignActor, companyId: string): Promise<CampaignRecord>;
export declare function updateCampaign(id: string, patch: Record<string, unknown>, actor: CampaignActor, companyId: string): Promise<CampaignRecord>;
/**
 * Absence handling (blueprint §12): an admin moves a user's unfinished work
 * to someone else, or - with no target - returns it to the queue so it is
 * redistributed, without losing campaign coverage.
 */
export declare function reassignWorkload(id: string, input: {
    fromUserId?: unknown;
    toUserId?: unknown;
}, actor: CampaignActor, companyId: string, now?: Date): Promise<{
    moved: number;
    returnedToQueue: number;
}>;
export type RunResult = {
    ran: boolean;
    skipped?: 'NOT_RUNNABLE' | 'NOT_STARTED' | 'ENDED' | 'ALREADY_RAN' | 'NO_ACTIVE_USERS';
    date?: string;
    assigned: number;
    perUser: Record<string, number>;
    queue: {
        added: number;
        excluded: number;
        restored: number;
    };
};
/**
 * One day's automatic allocation: reconcile, refresh the queue against current
 * stock, then top every active user up to DailyItemsPerUser open tasks in
 * priority order. Unfinished work rolls over (it counts toward the quota, so
 * nothing is duplicated). Safe to call repeatedly - a date that already ran
 * is skipped unless forced.
 */
export declare function runCampaignDay(id: string, companyId: string, options?: {
    now?: Date;
    force?: boolean;
    actor?: CampaignActor;
}): Promise<RunResult>;
/** Scheduler entry point: every running campaign, every company. Errors are isolated per campaign. */
export declare function runDueCampaigns(now?: Date): Promise<Array<{
    campaignId: string;
    result?: RunResult;
    error?: string;
}>>;
export type UserWorkload = {
    userId: string;
    name: string;
    open: number;
    submitted: number;
    approved: number;
    recount: number;
    available: boolean;
};
export declare function campaignDetail(id: string, companyId: string): Promise<{
    campaign: CampaignRecord;
    progress: import("./stock-take-campaign.js").ProgressSummary;
    workload: UserWorkload[];
}>;
export declare function campaignItemsView(id: string, companyId: string, status?: string, limit?: number, offset?: number): {
    total: number;
    items: {
        itemCode: string;
        itemName: string;
        assignedToName: string;
        campaignId: string;
        itemId: string;
        status: import("./stock-take-campaign.js").CampaignItemStatus;
        excludedReason?: string;
        assignedToId?: string;
        assignmentId?: string;
        countId?: string;
        assignedDate?: string;
        lastCountedAt?: string;
        recounts: number;
        addedAt: string;
        updatedAt: string;
    }[];
};
export declare function listCampaignSummaries(companyId: string, allowedLocationIds: string[] | null): {
    progress: import("./stock-take-campaign.js").ProgressSummary;
    id: string;
    companyId: string;
    name: string;
    locationId: string;
    status: CampaignStatus;
    dailyItemsPerUser: number;
    userIds: string[];
    priorityOrder: import("./stock-take-campaign.js").PriorityKey[];
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
}[];
export type { CampaignStatus };
