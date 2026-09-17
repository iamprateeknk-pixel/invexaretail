import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePageSize, paginateRows } from './pagination.js';

test('pagination returns a stable page window and range', () => {
  const result = paginateRows(Array.from({ length: 61 }, (_, index) => index + 1), 2, 25);
  assert.deepEqual(result.rows, Array.from({ length: 25 }, (_, index) => index + 26));
  assert.deepEqual({ page: result.page, pageCount: result.pageCount, from: result.from, to: result.to }, { page: 2, pageCount: 3, from: 26, to: 50 });
});

test('pagination clamps stale pages after filtering', () => {
  const result = paginateRows(['a', 'b'], 9, 25);
  assert.equal(result.page, 1);
  assert.deepEqual(result.rows, ['a', 'b']);
});

test('page sizes are bounded to protect the browser', () => {
  assert.equal(normalizePageSize(100), 100);
  assert.equal(normalizePageSize(1000), 25);
  assert.equal(normalizePageSize(0), 25);
});
