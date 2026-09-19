import test from 'node:test';
import assert from 'node:assert/strict';
import { metricsSnapshot, normalizeRoute, percentile, recordRequest, resetMetricsForTests } from './request-metrics.js';

test('percentiles come from the recent samples', () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([10], 95), 10);
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.deepEqual([percentile(values, 50), percentile(values, 95), percentile(values, 100)], [50, 95, 100]);
});

test('ids collapse so one route is one row, and only server errors count toward the error rate', () => {
  assert.equal(normalizeRoute('/api/v1/transfers/ckabcdefghijklmnopqrstu12/receive'), '/api/v1/transfers/:id/receive');
  assert.equal(normalizeRoute('/api/v1/orders/123/pack'), '/api/v1/orders/:id/pack');
  assert.equal(normalizeRoute('/api/v1/stock/loc-1'), '/api/v1/stock/loc-1');
  resetMetricsForTests();
  for (let index = 0; index < 8; index += 1) recordRequest('POST', '/api/v1/stock-counts', 201, 10 + index);
  recordRequest('POST', '/api/v1/stock-counts', 409, 5);
  recordRequest('POST', '/api/v1/stock-counts', 500, 300);
  recordRequest('GET', '/api/v1/items', 200, 1);
  const snapshot = metricsSnapshot();
  assert.equal(snapshot.totalRequests, 11);
  assert.equal(snapshot.serverErrors, 1);
  const counts = snapshot.busiest[0];
  assert.deepEqual([counts.route, counts.count, counts.clientErrors, counts.serverErrors, counts.errorRatePercent], ['/api/v1/stock-counts', 10, 1, 1, 10]);
  assert.equal(counts.p95Ms, 300);
  assert.equal(snapshot.slowest[0].route, '/api/v1/stock-counts');
  assert.deepEqual(snapshot.failing.map((row) => row.route), ['/api/v1/stock-counts']);
});
