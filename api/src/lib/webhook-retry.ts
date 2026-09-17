// Blueprint P6 "Sync journal: every external call - request id, retry
// count, payload hash, response status, error, next retry" and "Dead-letter
// queue: failed webhook/sync records visible to operations; replay safely
// with idempotency." This module only decides the retry schedule - pure and
// deterministic, no ML, matching the rest of this codebase's scheduling
// rules (e.g. reservation TTL, ABC cycle-count cadence).

import { createHash } from 'node:crypto';

// Backoff schedule indexed by attemptCount (1-based: the delay before the
// *next* attempt after this many attempts have already been made).
const BACKOFF_SCHEDULE_MS = [
  60_000, // 1 min after attempt 1
  5 * 60_000, // 5 min after attempt 2
  30 * 60_000, // 30 min after attempt 3
  2 * 60 * 60_000, // 2 hr after attempt 4
  12 * 60 * 60_000, // 12 hr after attempt 5
];

/**
 * Returns the delay in ms before the next retry, or null once the schedule
 * is exhausted - at that point the delivery is dead-lettered and only a
 * manual replay (never another automatic attempt) can move it forward.
 */
export function nextRetryDelayMs(attemptCount: number): number | null {
  if (attemptCount < 1) return BACKOFF_SCHEDULE_MS[0];
  const index = attemptCount - 1;
  return index < BACKOFF_SCHEDULE_MS.length ? BACKOFF_SCHEDULE_MS[index] : null;
}

export function nextRetryAt(attemptCount: number, from: Date = new Date()): string | null {
  const delay = nextRetryDelayMs(attemptCount);
  return delay === null ? null : new Date(from.getTime() + delay).toISOString();
}

export function isDeadLettered(attemptCount: number): boolean {
  return nextRetryDelayMs(attemptCount) === null;
}

export function hashPayload(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
