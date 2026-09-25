import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheCompanyTimezone, companyTimezone, currentTimezone, BUSINESS_TIMEZONE, runWithCompanyTimezone, validTimezone } from './timezone-context.js';
import { daysUntilExpiryDate, isExpiredOn } from './expiry-date.js';

test('unknown or invalid zones are rejected and fall back to the default', () => {
  assert.equal(validTimezone('Not/AZone'), null);
  cacheCompanyTimezone('co-bad', 'Not/AZone');
  assert.equal(companyTimezone('co-bad'), BUSINESS_TIMEZONE);
  assert.equal(companyTimezone(undefined), BUSINESS_TIMEZONE);
});

test('the request scope carries its own company zone and does not leak to other scopes', () => {
  cacheCompanyTimezone('co-ny', 'America/New_York');
  runWithCompanyTimezone('co-ny', () => assert.equal(currentTimezone(), 'America/New_York'));
  assert.equal(currentTimezone(), BUSINESS_TIMEZONE);
});

test('the same instant is a different calendar day per company, so expiry flips at each company\'s own midnight', () => {
  cacheCompanyTimezone('co-ist', 'Asia/Kolkata');
  cacheCompanyTimezone('co-la', 'America/Los_Angeles');
  // 2026-09-26 02:00 UTC = 07:30 on the 26th in Kolkata, 19:00 on the 25th in Los Angeles.
  const now = new Date('2026-09-26T02:00:00Z');
  const expiry = new Date('2026-09-25T00:00:00Z'); // usable THROUGH the 25th
  assert.equal(runWithCompanyTimezone('co-ist', () => isExpiredOn(expiry, now)), true, 'already the 26th in India');
  assert.equal(runWithCompanyTimezone('co-la', () => isExpiredOn(expiry, now)), false, 'still the 25th in Los Angeles');
  assert.equal(runWithCompanyTimezone('co-la', () => daysUntilExpiryDate(expiry, now)), 0);
});
