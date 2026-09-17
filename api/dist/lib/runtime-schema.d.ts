/**
 * Hostinger shared hosting does not expose a reliable release command. Keep
 * the additive daily-sync schema self-healing without altering or deleting
 * existing rows. Foreign keys are intentionally omitted for compatibility
 * with restricted MySQL accounts; Prisma still enforces model relations.
 */
export declare function ensureDailySyncSchema(): Promise<void>;
