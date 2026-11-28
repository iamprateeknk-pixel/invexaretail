import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readWorkerHealth, recordWorkerHealth, WORKER_HEALTH_WINDOW_MS } from './worker-health.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration('worker readiness requires fresh progress for the requested release', async () => {
  const release = randomUUID();
  const now = new Date();
  const later = new Date(now.getTime() + WORKER_HEALTH_WINDOW_MS + 1);
  assert.equal((await readWorkerHealth('unknown', now)).state, 'unidentified');
  assert.equal((await readWorkerHealth(release, now)).state, 'missing');
  await recordWorkerHealth(release, now, { outbox: now });
  assert.equal((await readWorkerHealth(release, now)).state, 'degraded');
  await recordWorkerHealth(release, now, { imports: now, automations: now, studioReleases: now });
  const healthy = await readWorkerHealth(release, now);
  assert.equal(healthy.state, 'ready');
  assert.equal(healthy.lastSuccess.outbox?.toISOString(), now.toISOString());
  assert.equal((await readWorkerHealth(randomUUID(), now)).state, 'missing');
  assert.equal((await readWorkerHealth(release, later)).state, 'stale');

  await recordWorkerHealth(release, later, { imports: later });
  assert.equal((await readWorkerHealth(release, later)).state, 'degraded');
  await recordWorkerHealth(release, later, { outbox: later, automations: later, studioReleases: later });
  await recordWorkerHealth(release, now, { outbox: now, imports: now });
  const refreshed = await readWorkerHealth(release, later);
  assert.equal(refreshed.state, 'ready');
  assert.equal(refreshed.lastSuccess.outbox?.toISOString(), later.toISOString());
  assert.equal(refreshed.heartbeatAt?.toISOString(), later.toISOString());
});
