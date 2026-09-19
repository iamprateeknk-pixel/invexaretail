import assert from 'node:assert/strict';
import test from 'node:test';
import { counterBadges, dayStatusMeta, localDate, shiftDate, syncHeadline } from './import-center.js';

const branch = (locationName, status) => ({ locationName, status });

test('day statuses have plain labels and colours', () => {
  assert.deepEqual([dayStatusMeta('UPLOADED').label, dayStatusMeta('PARTIAL').variant, dayStatusMeta('MISSING').variant], ['Uploaded', 'warning', 'destructive']);
  assert.equal(dayStatusMeta('???').label, '???');
});

test('local dates follow the timezone and can be stepped by day', () => {
  assert.equal(localDate(new Date('2026-09-18T20:00:00Z'), 'Asia/Kolkata'), '2026-09-19');
  assert.equal(localDate(new Date('2026-09-18T20:00:00Z'), 'UTC'), '2026-09-18');
  assert.equal(shiftDate('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});

test('the headline says whether stock figures can be trusted', () => {
  const clean = { sales: { status: 'UPLOADED', branches: [branch('Main', 'UPLOADED')], unattributedRejectedRows: 0 }, purchases: { status: 'UPLOADED', branches: [] } };
  assert.match(syncHeadline(clean), /All branches have uploaded/);
  const gaps = {
    sales: { status: 'PARTIAL', branches: [branch('Main', 'UPLOADED'), branch('Second', 'MISSING'), branch('Third', 'PARTIAL')], unattributedRejectedRows: 2 },
    purchases: { status: 'MISSING', branches: [] },
  };
  const text = syncHeadline(gaps);
  assert.match(text, /sales missing for Second/);
  assert.match(text, /rejected rows for Third/);
  assert.match(text, /2 sales row\(s\) rejected for an unknown branch/);
  assert.match(text, /no purchase file yet/);
  assert.equal(syncHeadline(null), '');
});

test('only non-zero rejection buckets are shown on a preview', () => {
  assert.deepEqual(counterBadges({ unmatchedItem: 3, unmatchedBranch: 0, unmatchedLot: 0, archivedItem: 1, rejected: 0 }), [
    { label: 'Unmatched items', count: 3 },
    { label: 'Archived items', count: 1 },
  ]);
  assert.deepEqual(counterBadges(undefined), []);
});
