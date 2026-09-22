import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flushControlPlanePersist,
  hydrateControlPlaneFromStore,
  scheduleControlPlanePersist,
} from './persistence.js';

test('hydrate and persist are no-ops without a database or during node:test', async () => {
  assert.equal(await hydrateControlPlaneFromStore(), 'skipped');
  scheduleControlPlanePersist();
  await flushControlPlanePersist();
});
