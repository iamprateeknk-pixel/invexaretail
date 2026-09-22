"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.percentile = percentile;
exports.normalizeRoute = normalizeRoute;
exports.recordRequest = recordRequest;
exports.requestMetricsMiddleware = requestMetricsMiddleware;
exports.metricsSnapshot = metricsSnapshot;
exports.resetMetricsForTests = resetMetricsForTests;
// Blueprint v4 §40 Observability - "API: latency and error rate by route".
// In-process and bounded: per route pattern a request count, status classes and
// the most recent durations (for percentiles). Nothing here stores request
// bodies, tokens or user data - only the route pattern and how long it took.
const SAMPLE_LIMIT = 200;
const ROUTE_LIMIT = 500;
const DEFAULT_SLOW_REQUEST_MS = 500;
const routes = new Map();
let started = Date.now();
let total = 0;
let failedTotal = 0;
function percentile(values, p) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[index] * 10) / 10;
}
/** Ids and long tokens collapse to :id so /transfers/abc123 and /transfers/def456 are one route. */
function normalizeRoute(path) {
    return path
        .split('/')
        .map((segment) => (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^c[a-z0-9]{20,}$/.test(segment) || /^\d+$/.test(segment) || segment.length > 24 ? ':id' : segment))
        .join('/');
}
function recordRequest(method, route, status, ms, now = new Date()) {
    total += 1;
    if (status >= 500)
        failedTotal += 1;
    const key = `${method} ${route}`;
    let row = routes.get(key);
    if (!row) {
        if (routes.size >= ROUTE_LIMIT)
            return;
        row = { method, route, count: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, samples: [], lastAt: '' };
        routes.set(key, row);
    }
    row.count += 1;
    row.totalMs += ms;
    if (status >= 500)
        row.serverErrors += 1;
    else if (status >= 400)
        row.clientErrors += 1;
    row.samples.push(ms);
    if (row.samples.length > SAMPLE_LIMIT)
        row.samples.shift();
    row.lastAt = now.toISOString();
}
function requestMetricsMiddleware(req, res, next) {
    const begun = process.hrtime.bigint();
    res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - begun) / 1e6;
        // req.route is the matched pattern (/transfers/:transferId/receive); fall back to a normalised path.
        const pattern = req.route?.path ? `${req.baseUrl}${typeof req.route.path === 'string' ? req.route.path : ''}` : normalizeRoute(req.originalUrl.split('?')[0]);
        recordRequest(req.method, pattern, res.statusCode, ms);
    });
    next();
}
function metricsSnapshot(limit = 25) {
    const rows = [...routes.values()].map((row) => ({
        method: row.method, route: row.route, count: row.count,
        errorRatePercent: Math.round(((row.serverErrors / row.count) * 100) * 10) / 10,
        serverErrors: row.serverErrors, clientErrors: row.clientErrors,
        avgMs: Math.round((row.totalMs / row.count) * 10) / 10,
        p50Ms: percentile(row.samples, 50), p95Ms: percentile(row.samples, 95), p99Ms: percentile(row.samples, 99), lastAt: row.lastAt,
    }));
    const configuredSlowThreshold = Number(process.env.SLOW_REQUEST_THRESHOLD_MS ?? DEFAULT_SLOW_REQUEST_MS);
    const slowThresholdMs = Number.isFinite(configuredSlowThreshold) ? Math.max(1, configuredSlowThreshold) : DEFAULT_SLOW_REQUEST_MS;
    return {
        uptimeSeconds: Math.round((Date.now() - started) / 1000),
        totalRequests: total,
        serverErrors: failedTotal,
        slowThresholdMs,
        slowRoutes: rows.filter((row) => (row.p95Ms ?? 0) >= slowThresholdMs).sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)).slice(0, limit),
        slowest: [...rows].sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0)).slice(0, limit),
        failing: rows.filter((row) => row.serverErrors > 0).sort((a, b) => b.serverErrors - a.serverErrors).slice(0, limit),
        busiest: [...rows].sort((a, b) => b.count - a.count).slice(0, limit),
    };
}
function resetMetricsForTests() {
    routes.clear();
    total = 0;
    failedTotal = 0;
    started = Date.now();
}
