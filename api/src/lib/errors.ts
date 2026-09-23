// ADR-006 / Week 7: one stable error envelope and trace ID, used by the
// reservation primitive, the six domain transition maps and the outbox
// worker. A stable `code` is a contract clients and dashboards can branch
// on; the free-text `message` is not (it may be reworded without notice).
import { randomUUID } from 'node:crypto';

export const ERROR_CODES = [
  'INSUFFICIENT_STOCK',
  'INVALID_TRANSITION',
  'CONCURRENT_UPDATE_CONFLICT',
  'DUPLICATE_REQUEST',
  'NOT_FOUND',
  'VALIDATION_FAILED',
] as const;
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
    default:
      return 400;
  }
}
