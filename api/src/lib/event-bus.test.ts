import assert from 'node:assert/strict';
import test from 'node:test';
import { outboxHealthSnapshot } from './event-bus.js';

test('outboxHealthSnapshot returns undefined in memory mode instead of throwing', async () => {
  // The default test run has no DATABASE_URL, so databaseEnabled is false -
  // this must short-circuit cleanly rather than touch prisma at all.
  const snapshot = await outboxHealthSnapshot();
  assert.equal(snapshot, undefined);
});
