import assert from 'node:assert/strict';
import test from 'node:test';
import { disposableDatabaseUrl } from './offline-rollback-rehearsal.mjs';

test('the rollback drill accepts only a named disposable database on loopback', () => {
  const fixture = 'postgresql://fixture@127.0.0.1:5432/invexa_rollback_run_1';
  assert.equal(disposableDatabaseUrl(fixture), fixture);
  for (const target of [
    'postgresql://fixture@database.example/invexa_rollback_run_1',
    'postgresql://fixture@127.0.0.1:5432/invexa_production',
    'postgresql://fixture@127.0.0.1:5432/invexa_rollback_run_1?host=database.example',
    'https://127.0.0.1/invexa_rollback_run_1',
  ]) {
    assert.throws(() => disposableDatabaseUrl(target), /fresh loopback PostgreSQL/);
  }
});
