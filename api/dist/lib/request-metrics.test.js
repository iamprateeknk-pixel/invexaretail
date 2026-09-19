"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const request_metrics_js_1 = require("./request-metrics.js");
(0, node_test_1.default)('percentiles come from the recent samples', () => {
    strict_1.default.equal((0, request_metrics_js_1.percentile)([], 95), null);
    strict_1.default.equal((0, request_metrics_js_1.percentile)([10], 95), 10);
    const values = Array.from({ length: 100 }, (_, index) => index + 1);
    strict_1.default.deepEqual([(0, request_metrics_js_1.percentile)(values, 50), (0, request_metrics_js_1.percentile)(values, 95), (0, request_metrics_js_1.percentile)(values, 100)], [50, 95, 100]);
});
(0, node_test_1.default)('ids collapse so one route is one row, and only server errors count toward the error rate', () => {
    strict_1.default.equal((0, request_metrics_js_1.normalizeRoute)('/api/v1/transfers/ckabcdefghijklmnopqrstu12/receive'), '/api/v1/transfers/:id/receive');
    strict_1.default.equal((0, request_metrics_js_1.normalizeRoute)('/api/v1/orders/123/pack'), '/api/v1/orders/:id/pack');
    strict_1.default.equal((0, request_metrics_js_1.normalizeRoute)('/api/v1/stock/loc-1'), '/api/v1/stock/loc-1');
    (0, request_metrics_js_1.resetMetricsForTests)();
    for (let index = 0; index < 8; index += 1)
        (0, request_metrics_js_1.recordRequest)('POST', '/api/v1/stock-counts', 201, 10 + index);
    (0, request_metrics_js_1.recordRequest)('POST', '/api/v1/stock-counts', 409, 5);
    (0, request_metrics_js_1.recordRequest)('POST', '/api/v1/stock-counts', 500, 300);
    (0, request_metrics_js_1.recordRequest)('GET', '/api/v1/items', 200, 1);
    const snapshot = (0, request_metrics_js_1.metricsSnapshot)();
    strict_1.default.equal(snapshot.totalRequests, 11);
    strict_1.default.equal(snapshot.serverErrors, 1);
    const counts = snapshot.busiest[0];
    strict_1.default.deepEqual([counts.route, counts.count, counts.clientErrors, counts.serverErrors, counts.errorRatePercent], ['/api/v1/stock-counts', 10, 1, 1, 10]);
    strict_1.default.equal(counts.p95Ms, 300);
    strict_1.default.equal(snapshot.slowest[0].route, '/api/v1/stock-counts');
    strict_1.default.deepEqual(snapshot.failing.map((row) => row.route), ['/api/v1/stock-counts']);
});
