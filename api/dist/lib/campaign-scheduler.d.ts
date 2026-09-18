/** One pass; a pass that overlaps a slower previous one is skipped, never stacked. */
export declare function campaignSchedulerTick(now?: Date): Promise<void>;
/**
 * Blueprint §12: daily assignment happens without an admin doing anything.
 * Passes are cheap and idempotent per local calendar date, so an interval
 * (plus one shortly after boot) also catches a day missed while the server
 * was down.
 */
export declare function startCampaignScheduler(): () => void;
