import { PrismaClient } from '@prisma/client';
export declare function resolveDatabaseUrl(): string;
export declare function validatePostgresUrl(url: string): string;
export declare function safeDatabaseError(error: unknown): {
    code: string;
    hint: string;
};
export declare const prisma: PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, import("@prisma/client").Prisma.LogLevel, import("@prisma/client/runtime/client").DefaultArgs>;
/** A cheap, real database round trip for readiness and admin diagnostics. */
export declare function databaseProbe(): Promise<{
    ok: true;
    latencyMs: number;
}>;
