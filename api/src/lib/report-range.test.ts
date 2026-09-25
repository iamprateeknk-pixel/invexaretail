import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportRangeError, resolveReportRange } from './report-range.js';

test('date-only bounds are whole calendar days in the report timezone (Asia/Kolkata, +05:30)', () => {
  const range = resolveReportRange({ from: '2026-09-25', to: '2026-09-25' });
  assert.equal(range.timezone, 'Asia/Kolkata');
  assert.equal(range.from, '2026-09-24T18:30:00.000Z');
  assert.equal(range.to, '2026-09-25T18:29:59.000Z');
});

test('the same day resolves differently in another timezone, and UTC is explicit', () => {
  const utc = resolveReportRange({ from: '2026-09-25', to: '2026-09-25', timezone: 'UTC' });
  assert.equal(utc.from, '2026-09-25T00:00:00.000Z');
  assert.equal(utc.to, '2026-09-25T23:59:59.000Z');
  const ny = resolveReportRange({ from: '2026-09-25', timezone: 'America/New_York' });
  assert.equal(ny.from, '2026-09-25T04:00:00.000Z');
});

test('an instant late on the last day is inside an inclusive `to` (the old string comparison dropped it)', () => {
  const { to } = resolveReportRange({ to: '2026-09-25' });
  assert.ok('2026-09-25T10:00:00.000Z' <= to!);
  assert.ok('2026-09-25T18:30:00.000Z' > to!, 'first instant of the next local day is outside');
});

test('ISO timestamps pass through normalised; missing bounds stay open', () => {
  assert.deepEqual(resolveReportRange({ from: '2026-09-25T10:00:00+05:30' }), { timezone: 'Asia/Kolkata', from: '2026-09-25T04:30:00.000Z', to: undefined });
  assert.deepEqual(resolveReportRange({}), { timezone: 'Asia/Kolkata', from: undefined, to: undefined });
});

test('bad input is a clear error, not a silently empty report', () => {
  assert.throws(() => resolveReportRange({ from: 'yesterday' }), ReportRangeError);
  assert.throws(() => resolveReportRange({ timezone: 'Mars/Base' }), /Unknown timezone/);
  assert.throws(() => resolveReportRange({ from: '2026-09-26', to: '2026-09-25' }), /from must not be after to/);
  assert.throws(() => resolveReportRange({ from: 5 }), ReportRangeError);
});
