export declare const ERROR_CODES: readonly ["INSUFFICIENT_STOCK", "INVALID_TRANSITION", "CONCURRENT_UPDATE_CONFLICT", "DUPLICATE_REQUEST", "NOT_FOUND", "VALIDATION_FAILED"];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorEnvelope = {
    error: string;
    code: ErrorCode;
    traceId: string;
};
/**
 * Base class for every domain error in the reservation/transition/outbox
 * path. Carries a stable `code` (part of the API contract) and a `traceId`
 * (generated if the caller doesn't already have one from an inbound
 * request) so a rejection is fully explainable from logs alone, without
 * correlating back to application state.
 */
export declare class DomainError extends Error {
    readonly code: ErrorCode;
    readonly traceId: string;
    constructor(code: ErrorCode, message: string, traceId?: string);
    toEnvelope(): ErrorEnvelope;
}
export declare function newTraceId(): string;
export declare function isDomainError(error: unknown): error is DomainError;
/** Express error-handler helper: sends the stable envelope with the right HTTP status. */
export declare function statusForErrorCode(code: ErrorCode): number;
