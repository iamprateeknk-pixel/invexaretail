import { PrismaClient } from '@prisma/client';
export declare function isRenderRuntime(): boolean;
/** Reads DATABASE_URL, or builds one from PG_* / DB_* parts for local/dev setups that prefer discrete env vars. */
export declare function resolveDatabaseUrl(): string;
export declare function safeDatabaseError(error: unknown): {
    code: string;
    hint: string;
};
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, import("@prisma/client").Prisma.LogLevel, import("@prisma/client/runtime/client").DefaultArgs>;
type RawClient = {
    $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
    $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};
export declare function queryRaw<T = unknown>(client: RawClient, sql: string, ...values: unknown[]): Promise<T>;
export declare function executeRaw(client: RawClient, sql: string, ...values: unknown[]): Promise<number>;
/** A cheap, real database round trip for readiness and admin diagnostics. */
export declare function databaseProbe(): Promise<{
    ok: true;
    latencyMs: number;
}>;
export {};
