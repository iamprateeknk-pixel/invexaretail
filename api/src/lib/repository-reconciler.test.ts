import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RepositoryReconciler, reconcileIntervalMs } from './repository-reconciler.js';

test('runOnce never overlaps itself: concurrent callers share one refresh', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reconciler = new RepositoryReconciler(async () => { runs += 1; await gate; }, 30_000);
  const calls = [reconciler.runOnce(), reconciler.runOnce(), reconciler.runOnce()];
  release();
  await Promise.all(calls);
  assert.equal(runs, 1);
  await reconciler.runOnce();
  assert.equal(runs, 2, 'a later tick runs again once the first finished');
});

test('a failing refresh is counted and reported, never thrown, and a success clears it', async () => {
  let fail = true;
  let now = 1_000_000;
  const reconciler = new RepositoryReconciler(async () => { if (fail) throw new Error('db down'); }, 30_000, () => now);
  reconciler.markFresh();
  await reconciler.runOnce();
  await reconciler.runOnce();
  assert.equal(reconciler.health().consecutiveFailures, 2);
  assert.equal(reconciler.health().lastError, 'db down');
  assert.equal(reconciler.health().stale, false, 'two failures is a warning, not yet stale');
  await reconciler.runOnce();
  assert.equal(reconciler.health().stale, true, 'three failures in a row marks the snapshot stale');
  fail = false;
  now += 1000;
  await reconciler.runOnce();
  const health = reconciler.health();
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastError, null);
  assert.equal(health.stale, false);
  assert.equal(health.ageMs, 0);
});

test('a snapshot that stops being refreshed turns stale by age even without errors', () => {
  let now = 0;
  const reconciler = new RepositoryReconciler(async () => {}, 30_000, () => now);
  assert.equal(reconciler.health().ageMs, null);
  assert.equal(reconciler.health().stale, false, 'before the first hydration there is nothing to be stale');
  reconciler.markFresh();
  now = 60_000;
  assert.equal(reconciler.health().stale, false);
  now = 91_000;
  assert.equal(reconciler.health().stale, true, 'older than three intervals');
});

test('start is idempotent, stop halts the timer, and the timer does not keep the process alive', async () => {
  let runs = 0;
  const reconciler = new RepositoryReconciler(async () => { runs += 1; }, 5);
  reconciler.start();
  reconciler.start();
  assert.equal(reconciler.health().running, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  reconciler.stop();
  const after = runs;
  assert.ok(after >= 1, 'it ran on the timer');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runs, after, 'stopped');
  assert.equal(reconciler.health().running, false);
});

test('health surfaces refresh provenance when a stats provider is supplied (ULTRA P1)', () => {
  const withStats = new RepositoryReconciler(async () => {}, 30_000, () => 0, () => ({ mode: 'delta', rowsLoaded: 3 }));
  assert.deepEqual(withStats.health().refresh, { mode: 'delta', rowsLoaded: 3 });
  const plain = new RepositoryReconciler(async () => {}, 30_000, () => 0);
  assert.equal(plain.health().refresh, undefined, 'no provider, no refresh block — existing consumers are unaffected');
});

test('the interval comes from DATABASE_REFRESH_INTERVAL_MS with a 5 second floor and a sane default', () => {
  assert.equal(reconcileIntervalMs({}), 30_000);
  assert.equal(reconcileIntervalMs({ DATABASE_REFRESH_INTERVAL_MS: '60000' }), 60_000);
  assert.equal(reconcileIntervalMs({ DATABASE_REFRESH_INTERVAL_MS: '100' }), 5_000);
  assert.equal(reconcileIntervalMs({ DATABASE_REFRESH_INTERVAL_MS: 'abc' }), 30_000);
});

// The invariant itself: a full repository hydration is started only at boot and by the
// reconciler, never from a request handler. Fails if someone adds a call in a route/middleware.
test('no request-path code calls the full repository hydration', () => {
  const root = join(__dirname, '..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
      const text = readFileSync(path, 'utf8');
      if (/hydrateRepositoryFromDatabase\s*\(/.test(text)) offenders.push(path.slice(root.length).split('\\').join('/').replace(/^\//, ''));
    }
  };
  walk(root);
  // persistence.ts defines it; index.ts calls it at startup and hands it to the reconciler.
  assert.deepEqual(offenders.sort(), ['index.ts', 'lib/persistence.ts']);
  const index = readFileSync(join(root, 'index.ts'), 'utf8');
  assert.ok(!/await\s+refreshRepositoryIfStale/.test(index), 'index.ts must not refresh the snapshot inside a request');
});
