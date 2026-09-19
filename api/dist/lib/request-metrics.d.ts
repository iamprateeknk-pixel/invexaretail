import type { NextFunction, Request, Response } from 'express';
export declare function percentile(values: number[], p: number): number | null;
/** Ids and long tokens collapse to :id so /transfers/abc123 and /transfers/def456 are one route. */
export declare function normalizeRoute(path: string): string;
export declare function recordRequest(method: string, route: string, status: number, ms: number, now?: Date): void;
export declare function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function metricsSnapshot(limit?: number): {
    uptimeSeconds: number;
    totalRequests: number;
    serverErrors: number;
    slowest: {
        method: string;
        route: string;
        count: number;
        errorRatePercent: number;
        serverErrors: number;
        clientErrors: number;
        avgMs: number;
        p50Ms: number;
        p95Ms: number;
        lastAt: string;
    }[];
    failing: {
        method: string;
        route: string;
        count: number;
        errorRatePercent: number;
        serverErrors: number;
        clientErrors: number;
        avgMs: number;
        p50Ms: number;
        p95Ms: number;
        lastAt: string;
    }[];
    busiest: {
        method: string;
        route: string;
        count: number;
        errorRatePercent: number;
        serverErrors: number;
        clientErrors: number;
        avgMs: number;
        p50Ms: number;
        p95Ms: number;
        lastAt: string;
    }[];
};
export declare function resetMetricsForTests(): void;
