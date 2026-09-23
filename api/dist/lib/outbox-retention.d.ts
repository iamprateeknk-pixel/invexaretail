export declare function pruneOutboxOnce(): Promise<number>;
/** Starts a background poll loop. Once a day is plenty for a retention sweep - call `stopOutboxRetention()` to stop it (used in tests and graceful shutdown). */
export declare function startOutboxRetention(intervalMs?: number): void;
export declare function stopOutboxRetention(): void;
