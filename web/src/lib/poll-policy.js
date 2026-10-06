// Plan P1-PERF-001 (event-first client freshness): while the live stream is
// healthy the client does NOT broadly poll every 15 s. Events drive targeted
// refetches. Polling exists for two reasons only:
//   * a slow safety reconciliation (>= 120 s) for writes made directly in the database, and
//   * a fallback while the stream is degraded, with exponential backoff and jitter.
import { LIVE_STATUS } from './live-events.js';

export const SAFETY_POLL_MS = 180_000; // healthy stream: reconcile every 3 minutes
export const MIN_SAFETY_POLL_MS = 120_000; // the plan's floor for a retained safety poll
export const FALLBACK_BASE_MS = 15_000;
export const FALLBACK_MAX_MS = 120_000;
const JITTER = 0.2; // +/-20%, so a fleet that lost the stream together does not poll in lockstep

/**
 * Milliseconds until the next broad refresh, or null for "do not poll".
 * `consecutiveFailures` is how many fallback polls in a row have failed.
 */
export function nextPollDelayMs({ status, consecutiveFailures = 0, random = Math.random }) {
  const jittered = (ms) => Math.round(ms * (1 - JITTER + 2 * JITTER * random()));
  switch (status) {
    case LIVE_STATUS.live:
      return Math.max(MIN_SAFETY_POLL_MS, jittered(SAFETY_POLL_MS));
    case LIVE_STATUS.unauthorized:
      return null; // a polling loop cannot fix an expired session; the auth layer handles it
    case LIVE_STATUS.connecting:
    case LIVE_STATUS.reconnecting:
    case LIVE_STATUS.stale:
    case LIVE_STATUS.polling:
    case LIVE_STATUS.offline:
    default: {
      const backoff = Math.min(FALLBACK_BASE_MS * 2 ** Math.min(consecutiveFailures, 10), FALLBACK_MAX_MS);
      return jittered(backoff);
    }
  }
}
