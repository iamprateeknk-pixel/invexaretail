export declare function sweepExpiredLots(now?: Date): Promise<{
    expired: number;
}>;
/** Runs once at start-up and then every `intervalMs` (default 6 h, so a lot flips within hours of IST midnight). */
export declare function startExpirySweep(intervalMs?: number): void;
export declare function stopExpirySweep(): void;
