import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignStatusMeta, describeRunResult, progressSegments, storeUsersForLocation, validateCampaignForm } from './campaigns.js';

test('each campaign status offers only the actions its state allows', () => {
  assert.deepEqual(campaignStatusMeta('DRAFT').actions, ['activate', 'cancel']);
  assert.deepEqual(campaignStatusMeta('COUNTING').actions, ['run', 'pause', 'cancel']);
  assert.deepEqual(campaignStatusMeta('PAUSED').actions, ['resume', 'cancel']);
  assert.deepEqual(campaignStatusMeta('COMPLETED').actions, []);
  assert.deepEqual(campaignStatusMeta('CANCELLED').actions, []);
  assert.equal(campaignStatusMeta('WEIRD').label, 'WEIRD');
});

test('only store users assigned to the location can be picked', () => {
  const users = [
    { id: 'a', assignedLocationIds: ['loc-1'] },
    { id: 'b', assignedLocationIds: ['loc-2'] },
    { id: 'c' },
  ];
  assert.deepEqual(storeUsersForLocation(users, 'loc-1').map((user) => user.id), ['a']);
  assert.deepEqual(storeUsersForLocation(undefined, 'loc-1'), []);
});

test('the create form is validated and turned into the API payload', () => {
  const bad = validateCampaignForm({ name: 'x', dailyItemsPerUser: '0', userIds: [], startDate: '2026-09-10' }, '');
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);

  const good = validateCampaignForm({ name: ' Sept count ', dailyItemsPerUser: '25', userIds: ['u1'], startDate: '', endDate: '2026-09-30', includeNewStock: false }, 'loc-1');
  assert.equal(good.ok, true);
  assert.deepEqual(good.payload, { name: 'Sept count', locationId: 'loc-1', dailyItemsPerUser: 25, userIds: ['u1'], includeNewStock: false });
});

test('progress segments skip empty and excluded buckets', () => {
  const segments = progressSegments({ byStatus: { PENDING: 3, ASSIGNED: 0, APPROVED: 2, EXCLUDED: 4 } });
  assert.deepEqual(segments.map((segment) => [segment.key, segment.count]), [['PENDING', 3], ['APPROVED', 2]]);
  assert.deepEqual(progressSegments(undefined), []);
});

test('run results are explained in plain language', () => {
  assert.match(describeRunResult({ ran: true, assigned: 4, perUser: { a: 2, b: 2 } }), /Assigned 4 items to 2 users/);
  assert.match(describeRunResult({ ran: true, assigned: 1, perUser: { a: 1 } }), /Assigned 1 item to 1 user\./);
  assert.match(describeRunResult({ ran: true, assigned: 0, perUser: {} }), /nothing new/);
  assert.match(describeRunResult({ ran: false, skipped: 'ALREADY_RAN' }), /already assigned/);
  assert.equal(describeRunResult(null), '');
});
