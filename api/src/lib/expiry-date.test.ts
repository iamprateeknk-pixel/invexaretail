import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilExpiryDate, expiryDayNumber, isExpiredOn, todayDayNumber } from './expiry-date.js';

// Asia/Kolkata is UTC+05:30. 2026-09-25T20:00Z is already 01:30 on 2026-09-26 in India.
const lateEveningUtc = new Date('2026-09-25T20:00:00Z');
const noonIst = new Date('2026-09-26T06:30:00Z');

test('today is the calendar date in the business timezone, not the host (UTC) date', () => {
  assert.equal(todayDayNumber(lateEveningUtc), todayDayNumber(noonIst));
  assert.equal(todayDayNumber(lateEveningUtc, 'UTC') + 1, todayDayNumber(lateEveningUtc));
});

test('a lot is usable through its expiry date and expired the day after', () => {
  assert.equal(daysUntilExpiryDate('2026-09-26T00:00:00.000Z', noonIst), 0);
  assert.equal(isExpiredOn('2026-09-26T00:00:00.000Z', noonIst), false, 'expires today = still usable today');
  assert.equal(isExpiredOn('2026-09-25T00:00:00.000Z', noonIst), true);
  assert.equal(daysUntilExpiryDate('2026-09-25T00:00:00.000Z', noonIst), -1);
  assert.equal(daysUntilExpiryDate('2026-10-03T00:00:00.000Z', noonIst), 7);
});

test('after IST midnight the store and the server agree that yesterday\'s lot is expired', () => {
  // 01:30 IST on the 26th: a lot dated the 25th must already be expired, even though the host clock (UTC) still says the 25th.
  assert.equal(isExpiredOn('2026-09-25T00:00:00.000Z', lateEveningUtc), true);
  assert.equal(isExpiredOn('2026-09-26T00:00:00.000Z', lateEveningUtc), false);
});

test('a date-only expiry is never shifted by the host timezone; missing or invalid values are null, not expired', () => {
  assert.equal(expiryDayNumber('2027-12-31T00:00:00.000Z'), expiryDayNumber(new Date(Date.UTC(2027, 11, 31))));
  assert.equal(daysUntilExpiryDate(null), null);
  assert.equal(daysUntilExpiryDate('not a date'), null);
  assert.equal(isExpiredOn(undefined), false);
  assert.equal(isExpiredOn(''), false);
});
