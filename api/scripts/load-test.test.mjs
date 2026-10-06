import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize } from './load-test.mjs';

test('percentile uses the nearest-rank method', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 100);
  assert.equal(percentile(sorted, 99), 100);
  assert.equal(percentile([], 95), 0);
});

test('summarize counts errors separately and excludes them from latency', () => {
  const samples = [
    { ok: true, ms: 10 }, { ok: true, ms: 20 }, { ok: true, ms: 30 }, { ok: true, ms: 40 },
    { ok: false, ms: 5000 },
  ];
  const result = summarize(samples, 1000);
  assert.equal(result.requests, 5);
  assert.equal(result.errors, 1);
  assert.equal(result.errorRate, 0.2);
  assert.equal(result.rps, 5);
  assert.equal(result.max, 40, 'a failed request must not distort latency');
});
