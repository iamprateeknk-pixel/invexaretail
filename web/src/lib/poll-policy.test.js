import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_BASE_MS, FALLBACK_MAX_MS, MIN_SAFETY_POLL_MS, SAFETY_POLL_MS, nextPollDelayMs } from './poll-policy.js';
import { LIVE_STATUS } from './live-events.js';

const mid = () => 0.5; // jitter factor exactly 1.0

test('a healthy stream never broad-polls at the old 12-15 second cadence', () => {
  for (const random of [() => 0, () => 0.5, () => 1]) {
    const delay = nextPollDelayMs({ status: LIVE_STATUS.live, random });
    assert.ok(delay >= MIN_SAFETY_POLL_MS, `${delay}ms is under the 120 s floor`);
  }
  assert.equal(nextPollDelayMs({ status: LIVE_STATUS.live, random: mid }), SAFETY_POLL_MS);
});

test('a degraded stream falls back to polling, with exponential backoff capped at 2 minutes', () => {
  const delays = [0, 1, 2, 3, 4, 5, 9].map((consecutiveFailures) => nextPollDelayMs({ status: LIVE_STATUS.polling, consecutiveFailures, random: mid }));
  assert.deepEqual(delays, [FALLBACK_BASE_MS, 30_000, 60_000, FALLBACK_MAX_MS, FALLBACK_MAX_MS, FALLBACK_MAX_MS, FALLBACK_MAX_MS]);
});

test('every non-live, non-auth status uses the fallback schedule', () => {
  for (const status of [LIVE_STATUS.connecting, LIVE_STATUS.reconnecting, LIVE_STATUS.stale, LIVE_STATUS.polling, LIVE_STATUS.offline]) {
    assert.equal(nextPollDelayMs({ status, random: mid }), FALLBACK_BASE_MS, status);
  }
});

test('jitter stays within +/-20 percent so clients do not retry in lockstep', () => {
  const low = nextPollDelayMs({ status: LIVE_STATUS.offline, consecutiveFailures: 1, random: () => 0 });
  const high = nextPollDelayMs({ status: LIVE_STATUS.offline, consecutiveFailures: 1, random: () => 1 });
  assert.equal(low, 24_000);
  assert.equal(high, 36_000);
});

test('an unauthorized session does not poll at all', () => {
  assert.equal(nextPollDelayMs({ status: LIVE_STATUS.unauthorized }), null);
});
