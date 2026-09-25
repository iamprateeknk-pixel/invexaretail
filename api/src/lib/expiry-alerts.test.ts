import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilExpiry, expirySeverity, recommendedExpiryAction } from './expiry-alerts.js';

test('expiry day calculation is calendar-day based', () => {
  assert.equal(daysUntilExpiry(new Date('2026-09-13T23:59:00Z'), new Date('2026-09-13T01:00:00Z')), 0);
  // 23:00Z on the 13th is already 04:30 IST on the 14th, so the business day is the 14th (not the host's UTC day).
  assert.equal(daysUntilExpiry(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-13T23:00:00Z')), 6);
  assert.equal(daysUntilExpiry(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-13T10:00:00Z')), 7);
});
test('expiry severity boundaries are deterministic', () => {
  assert.equal(expirySeverity(-1), 'EXPIRED');
  assert.equal(expirySeverity(7), 'CRITICAL');
  assert.equal(expirySeverity(30), 'WARNING');
  assert.equal(expirySeverity(31), 'UPCOMING');
  assert.match(recommendedExpiryAction(-1), /write-off/);
  assert.match(recommendedExpiryAction(Number.POSITIVE_INFINITY), /expiry date/);
});
