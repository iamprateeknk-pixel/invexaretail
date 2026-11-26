import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduledStudioOccurrence } from './studio-schedule.js';

test('a daily run is due once the local time is reached and never for an earlier publication slot', () => {
  const publication = new Date('2027-02-01T01:00:00Z');
  const due = (now: string) => scheduledStudioOccurrence('daily@09:00', new Date(now), 'Asia/Kolkata', publication);
  assert.equal(due('2027-02-01T03:29:00Z'), null);
  assert.equal(due('2027-02-01T03:30:00Z'), '2027-02-01');
  assert.equal(due('2027-02-01T12:30:00Z'), '2027-02-01');
  assert.equal(scheduledStudioOccurrence('daily@09:00', new Date('2027-02-01T06:00:00Z'), 'Asia/Kolkata', new Date('2027-02-01T04:00:00Z')), null);
});

test('weekly and monthly schedules use the first local hour of their scheduled day across time zones', () => {
  const publication = new Date('2027-01-01T00:00:00Z');
  const candidates = ['weekly@mon', 'monthly@1'] as const;
  for (const expression of candidates) {
    assert.equal(scheduledStudioOccurrence(expression, new Date('2027-02-01T03:30:00Z'), 'Asia/Kolkata', publication), '2027-02-01');
    assert.equal(scheduledStudioOccurrence(expression, new Date('2027-02-01T03:30:00Z'), 'America/Los_Angeles', publication), null);
    assert.equal(scheduledStudioOccurrence(expression, new Date('2027-02-02T03:30:00Z'), 'Asia/Kolkata', publication), null);
  }
});
