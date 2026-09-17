import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flushControlPlanePersist,
  hydrateControlPlaneFromStore,
  scheduleControlPlanePersist,
} from './persistence.js';

test('hydrate and persist are no-ops without MySQL or during node:test', async () => {
  assert.equal(await hydrateControlPlaneFromStore(), 'skipped');
  scheduleControlPlanePersist();
  await flushControlPlanePersist();
});
