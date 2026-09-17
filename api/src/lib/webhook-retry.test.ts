import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRetryDelayMs, nextRetryAt, isDeadLettered, hashPayload } from './webhook-retry.js';

test('the backoff schedule increases with each attempt', () => {
  const delays = [0, 1, 2, 3, 4].map((count) => nextRetryDelayMs(count));
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok((delays[index] ?? 0) >= (delays[index - 1] ?? 0));
  }
});

test('the schedule is exhausted after 5 scheduled retries - dead-lettered, no further auto-retry', () => {
  assert.equal(nextRetryDelayMs(6), null);
  assert.equal(nextRetryAt(6), null);
  assert.equal(isDeadLettered(6), true);
  assert.equal(isDeadLettered(5), false);
});

test('nextRetryAt adds the backoff delay to the given time', () => {
  const from = new Date('2026-09-16T00:00:00.000Z');
  const result = nextRetryAt(1, from);
  assert.equal(result, new Date(from.getTime() + (nextRetryDelayMs(1) ?? 0)).toISOString());
});

test('hashPayload is deterministic and distinguishes different payloads', () => {
  assert.equal(hashPayload('{"a":1}'), hashPayload('{"a":1}'));
  assert.notEqual(hashPayload('{"a":1}'), hashPayload('{"a":2}'));
});
