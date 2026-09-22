import { PrismaClient } from '@prisma/client';
export declare function isRenderRuntime(): boolean;
export declare function publicMysqlHost(): string;
/**
 * Hostinger phpMyAdmin shows Server 127.0.0.1. That only works on the
 * Hostinger machine. Render copied the same DATABASE_URL would otherwise
 * point at Render itself. Rewrite loopback to the public MariaDB host.
 */
export declare function resolveDatabaseUrl(): string;
export declare function parseMysqlUrl(url: string): {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
};
export declare function mysqlPoolConfig(url: string): {
    connectionLimit: number;
    minimumIdle: number;
    acquireTimeout: number;
    connectTimeout: number;
    idleTimeout: number;
    resetAfterUse: boolean;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
};
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
