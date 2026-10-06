import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_API_RATE_LIMIT_PER_MINUTE, apiRateLimitPerMinute } from './rate-limit-config.js';

test('defaults to 240 per minute when unset or blank', () => {
  assert.equal(apiRateLimitPerMinute({}), DEFAULT_API_RATE_LIMIT_PER_MINUTE);
  assert.equal(apiRateLimitPerMinute({ API_RATE_LIMIT_PER_MINUTE: '  ' }), 240);
});

test('accepts a positive integer override', () => {
  assert.equal(apiRateLimitPerMinute({ API_RATE_LIMIT_PER_MINUTE: '1200' }), 1200);
});

test('ignores garbage, zero, negatives and fractions (falls back to the default)', () => {
  for (const bad of ['abc', '0', '-5', '1.5', 'NaN', '12e3x']) {
    assert.equal(apiRateLimitPerMinute({ API_RATE_LIMIT_PER_MINUTE: bad }), 240, bad);
  }
});

test('is capped so a typo cannot disable the limiter in practice', () => {
  assert.equal(apiRateLimitPerMinute({ API_RATE_LIMIT_PER_MINUTE: '99999999999' }), 1_000_000);
});
