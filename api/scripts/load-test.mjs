#!/usr/bin/env node
// Phase 6: dependency-free load probe for a running API. It signs in once, then
// drives each endpoint with a fixed number of concurrent workers and reports
// latency percentiles and errors. Not a replacement for a proper load-testing
// service, but enough to catch regressions and to put numbers on a change.
//
//   API_URL=http://127.0.0.1:4000 LOAD_EMAIL=admin@retail.local LOAD_PASSWORD=... \
//     node scripts/load-test.mjs [--duration 10] [--concurrency 20] [--path /api/v1/items/search?limit=25]
//
// Exit code 1 if the error rate exceeds --max-error-rate (default 1%) or any
// endpoint's p95 exceeds --p95-budget-ms (default: no budget), so CI can gate on it.
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const API_URL = (process.env.API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const EMAIL = process.env.LOAD_EMAIL || 'admin@retail.local';
const PASSWORD = process.env.LOAD_PASSWORD || process.env.SEED_PASSWORD || '';
const DURATION_S = Number(flag('duration', '10'));
const CONCURRENCY = Number(flag('concurrency', '20'));
const MAX_ERROR_RATE = Number(flag('max-error-rate', '0.01'));
const P95_BUDGET_MS = flag('p95-budget-ms') === undefined ? null : Number(flag('p95-budget-ms'));
const customPath = flag('path');

const DEFAULT_PATHS = [
  '/api/v1/items/search?limit=25',
  '/api/v1/transfers/list',
  '/api/v1/reports/dashboard',
  '/api/v1/reports/exceptions',
];

export function percentile(sortedMs, p) {
  if (!sortedMs.length) return 0;
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, index)];
}

export function summarize(samples, elapsedMs) {
  const ok = samples.filter((sample) => sample.ok);
  const sorted = ok.map((sample) => sample.ms).sort((a, b) => a - b);
  return {
    requests: samples.length,
    errors: samples.length - ok.length,
    errorRate: samples.length ? (samples.length - ok.length) / samples.length : 0,
    rps: samples.length / (elapsedMs / 1000),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
  };
}

async function signIn() {
  if (!PASSWORD) throw new Error('Set LOAD_PASSWORD (or SEED_PASSWORD) to sign in.');
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) throw new Error(`Sign-in failed (${response.status}): ${body.error ?? 'no token'}`);
  return body.token;
}

async function probe(path, token) {
  const samples = [];
  const deadline = Date.now() + DURATION_S * 1000;
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < deadline) {
      const t0 = performance.now();
      try {
        const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' } });
        await response.arrayBuffer();
        samples.push({ ok: response.ok, ms: performance.now() - t0 });
      } catch {
        samples.push({ ok: false, ms: performance.now() - t0 });
      }
    }
  }));
  return summarize(samples, Date.now() - started);
}

async function main() {
  const token = await signIn();
  const paths = customPath ? [customPath] : DEFAULT_PATHS;
  console.log(`Load probe: ${API_URL}  duration=${DURATION_S}s  concurrency=${CONCURRENCY}`);
  console.log('path'.padEnd(44), 'req'.padStart(7), 'err'.padStart(5), 'rps'.padStart(7), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'max'.padStart(7));
  let failed = false;
  for (const path of paths) {
    const r = await probe(path, token);
    console.log(path.padEnd(44), String(r.requests).padStart(7), String(r.errors).padStart(5), r.rps.toFixed(0).padStart(7), r.p50.toFixed(0).padStart(7), r.p95.toFixed(0).padStart(7), r.p99.toFixed(0).padStart(7), r.max.toFixed(0).padStart(7));
    if (r.errorRate > MAX_ERROR_RATE) { console.error(`  FAIL: error rate ${(r.errorRate * 100).toFixed(1)}% > ${(MAX_ERROR_RATE * 100).toFixed(1)}%`); failed = true; }
    if (P95_BUDGET_MS !== null && r.p95 > P95_BUDGET_MS) { console.error(`  FAIL: p95 ${r.p95.toFixed(0)}ms > budget ${P95_BUDGET_MS}ms`); failed = true; }
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('load-test.mjs')) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
