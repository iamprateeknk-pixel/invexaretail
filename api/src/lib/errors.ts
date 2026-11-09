// ADR-006 / Week 7: one stable error envelope and trace ID, used by the
// reservation primitive, the six domain transition maps and the outbox
// worker. A stable `code` is a contract clients and dashboards can branch
// on; the free-text `message` is not (it may be reworded without notice).
//
// [ULTRA] P3 (#186): the same envelope is now the single error shape for
// every route in the converted files (see lib/validate.ts). `sendError`
// is the one way a route sends an error: same status the route sent
// before, same message text moved into `error`, plus the stable `code`.
// Extra fields a client already reads (approvalRequestId, shortages,
// verification, guardrail, missingIds, lineId/itemId, errors) are kept
// as top-level extras next to the envelope, not folded into it.
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';

export const ERROR_CODES = [
  'INSUFFICIENT_STOCK',
  'INVALID_TRANSITION',
  'CONCURRENT_UPDATE_CONFLICT',
  'DUPLICATE_REQUEST',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  // [ULTRA] P3 (#186): generic HTTP rejections, so a route never has to
  // invent an ad-hoc code (or send a bare `{ message }`) again.
  'FORBIDDEN',
  'CONFLICT',
  'INTERNAL_ERROR',
  'NOT_SUPPORTED',
  'UPSTREAM_ERROR',
  // Codes already sent ad hoc inside error bodies before P3, now named here.
  'QC_REQUIRED',
  'SELF_REVIEW',
  'RECOUNT_REQUIRED',
  'RECOUNT_NOT_INDEPENDENT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** One entry of a zod validation failure: which field, and why. */
export type ValidationIssue = {
  path: string;
  message: string;
};

export type ErrorEnvelope = {
  error: string;
  code: ErrorCode;
  traceId: string;
  /** Zod issues for a VALIDATION_FAILED 400; other structured detail otherwise. */
  details?: unknown;
};

/**
 * Base class for every domain error in the reservation/transition/outbox
 * path. Carries a stable `code` (part of the API contract) and a `traceId`
 * (generated if the caller doesn't already have one from an inbound
 * request) so a rejection is fully explainable from logs alone, without
 * correlating back to application state.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly traceId: string;

  constructor(code: ErrorCode, message: string, traceId?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.traceId = traceId ?? randomUUID();
  }

  toEnvelope(): ErrorEnvelope {
    return { error: this.message, code: this.code, traceId: this.traceId };
  }
}

export function newTraceId(): string {
  return randomUUID();
}

/** Build the envelope without sending it (tests, non-Express callers). */
export function errorEnvelope(
  code: ErrorCode,
  message: string,
  traceId?: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error: message,
    code,
    traceId: traceId ?? randomUUID(),
    ...(details !== undefined ? { details } : {}),
  };
}

/**
 * [ULTRA] P3 (#186): the one way a converted route sends an error.
 * `status` and `message` are exactly what the route sent before (no
 * behaviour change beyond the shape); `code` is the stable machine
 * branch. `extra` carries the top-level fields a client already reads
 * from that error (approvalRequestId, shortages, verification, guardrail,
 * missingIds, lineId/itemId, errors) — kept for compatibility, not part
 * of the envelope itself. The trace id is the request's own
 * `res.locals.requestId` when the app set one, else a fresh UUID.
 */
export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const traceId =
    typeof res.locals?.requestId === 'string' && res.locals.requestId
      ? res.locals.requestId
      : randomUUID();
  // `details` (zod issues, guardrail detail) lives inside the envelope;
  // every other extra key stays top-level for compatibility.
  const { details, ...rest } = extra ?? {};
  res.status(status).json({ ...errorEnvelope(code, message, traceId, details), ...rest });
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Express error-handler helper: sends the stable envelope with the right HTTP status. */
export function statusForErrorCode(code: ErrorCode): number {
  switch (code) {
    case 'INSUFFICIENT_STOCK':
    case 'INVALID_TRANSITION':
    case 'VALIDATION_FAILED':
      return 422;
    case 'CONCURRENT_UPDATE_CONFLICT':
      return 409;
    case 'DUPLICATE_REQUEST':
      return 200;
    case 'NOT_FOUND':
      return 404;
    // [ULTRA] P3 (#186): mappings for the new generic codes, so a
    // DomainError carrying one still gets the right status from the
    // last-resort handler. Note VALIDATION_FAILED stays 422 here: that
    // mapping belongs to DomainError throws. Schema validation failures
    // go through lib/validate.ts, which sends 400 directly per #186's
    // acceptance criterion ("invalid payloads return the single
    // envelope with 400") — the two paths are deliberately different.
    case 'FORBIDDEN':
    case 'SELF_REVIEW':
      return 403;
    case 'CONFLICT':
    case 'RECOUNT_REQUIRED':
    case 'RECOUNT_NOT_INDEPENDENT':
      return 409;
    case 'QC_REQUIRED':
      return 400;
    case 'INTERNAL_ERROR':
      return 500;
    case 'NOT_SUPPORTED':
      return 501;
    case 'UPSTREAM_ERROR':
      return 502;
    default:
      return 400;
  }
}
