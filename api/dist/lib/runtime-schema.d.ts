/**
 * Verify that the migration-managed PostgreSQL schema is reachable.
 * Application startup never creates or mutates tables at runtime.
 */
export declare function ensureRuntimeSchema(): Promise<void>;
export declare const ensureDailySyncSchema: typeof ensureRuntimeSchema;
