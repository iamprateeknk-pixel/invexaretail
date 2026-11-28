import assert from 'node:assert/strict';
import test from 'node:test';
import { assertWorkerSchemaCurrent } from './worker-schema-guard.js';

test('worker startup rejects a database missing migrations from this build', () => {
  assert.throws(
    () => assertWorkerSchemaCurrent({
      ok: false,
      reason: 'Database schema is out of date.',
      missing: ['20261125090000_example'],
      unfinished: [],
    }),
    /Database schema is out of date/,
  );
});

test('worker startup accepts a verified database schema', () => {
  assert.doesNotThrow(() => assertWorkerSchemaCurrent({ ok: true, appliedCount: 1 }));
});
