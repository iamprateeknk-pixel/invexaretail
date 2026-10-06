import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationNames, withDatabase } from './migration-matrix.mjs';

test('migrations are listed in apply order and are all directories', () => {
  const names = migrationNames();
  assert.ok(names.length > 20);
  assert.deepEqual(names, [...names].sort());
  assert.ok(names.every((name) => /^\d{14}_/.test(name)), 'every migration folder starts with its timestamp');
});

test('withDatabase swaps only the database name', () => {
  assert.equal(withDatabase('postgresql://ci:ci@127.0.0.1:5432/postgres', 'matrix_fresh'), 'postgresql://ci:ci@127.0.0.1:5432/matrix_fresh');
});
