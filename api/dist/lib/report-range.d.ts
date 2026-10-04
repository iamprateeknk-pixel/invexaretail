export type ReportRangeInput = {
    from?: unknown;
    to?: unknown;
    timezone?: unknown;
};
export type ResolvedReportRange = {
    timezone: string;
    from?: string;
    to?: string;
};
export declare class ReportRangeError extends Error {
    constructor(message: string);
}
export declare function resolveReportRange(input: ReportRangeInput): ResolvedReportRange;
