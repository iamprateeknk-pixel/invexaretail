/**
 * Returns the delay in ms before the next retry, or null once the schedule
 * is exhausted - at that point the delivery is dead-lettered and only a
 * manual replay (never another automatic attempt) can move it forward.
 */
export declare function nextRetryDelayMs(attemptCount: number): number | null;
export declare function nextRetryAt(attemptCount: number, from?: Date): string | null;
export declare function isDeadLettered(attemptCount: number): boolean;
export declare function hashPayload(body: string): string;
