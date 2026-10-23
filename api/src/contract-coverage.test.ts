// Release checklist / plan Area A WP3 ("Contract-first API ... all release-critical endpoints represented"):
// how much of the real API surface the OpenAPI contract describes, measured instead of guessed.
//
// It walks the routers that serve /api/v1, normalises `:id` to `{id}`, and compares each METHOD + path with
// contracts/openapi.json. The percentage is a RATCHET: it may go up, never down, so a new route added
// without documenting it (or a documented route removed) is noticed in CI. Raise the floor in
// contracts/coverage-floor.json when coverage improves (`COVERAGE_UPDATE=1`).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { Router } from 'express';
import coreRouter from './routes/core.js';
import transfersRouter from './routes/transfers.js';
import branchesRouter from './routes/branches.js';
import itemsRouter from './routes/items.js';
import bundlesRouter from './routes/bundles.js';
import importsRouter from './routes/imports.js';
import reportsRouter from './routes/reports.js';
import entitiesRouter from './routes/entities.js';
import catalogProcurementRouter from './routes/catalog-procurement.js';
import operationsExtensionRouter from './routes/operations-extension.js';
import commandCenterRouter from './routes/command-center.js';
import enterpriseAuthRouter from './routes/enterprise-auth.js';

type Layer = { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };

function endpoints(router: Router, prefix = ''): string[] {
  const out: string[] = [];
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    // core.ts is composed of mounted sub-routers; walk into them.
    if (!layer.route && layer.handle?.stack) { out.push(...endpoints(layer.handle as unknown as Router, prefix)); continue; }
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${prefix}${path.replace(/:([A-Za-z]+)\??/g, '{$1}')}`);
    }
  }
  return out;
}

const root = process.cwd();
const spec = JSON.parse(readFileSync(join(root, 'contracts/openapi.json'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
const documented = new Set<string>();
const pathOnly = new Set<string>(); // listed with method/path/params/auth; body shapes not yet specified
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of Object.keys(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const key = `${method.toUpperCase()} ${path}`;
    documented.add(key);
    if ((item[method] as { 'x-contract-level'?: string })['x-contract-level'] === 'path-only') pathOnly.add(key);
  }
}

const routers: Array<[string, Router, string]> = [
  ['core', coreRouter, ''], ['transfers', transfersRouter, ''], ['branches', branchesRouter, ''], ['items', itemsRouter, ''],
  ['bundles', bundlesRouter, ''], ['imports', importsRouter, ''], ['reports', reportsRouter, ''], ['entities', entitiesRouter, ''],
  ['catalog-procurement', catalogProcurementRouter, ''], ['operations-extension', operationsExtensionRouter, ''],
  ['command-center', commandCenterRouter, ''], ['auth', enterpriseAuthRouter, '/auth'],
];

const all = new Set<string>();
for (const [, router, prefix] of routers) for (const endpoint of endpoints(router, prefix)) all.add(endpoint);
// Routes may be mounted under a path the contract spells without the router prefix; match on METHOD + path.
const covered = [...all].filter((endpoint) => documented.has(endpoint));
const percent = all.size ? Math.round((covered.length / all.size) * 1000) / 10 : 100;
const specified = covered.filter((endpoint) => !pathOnly.has(endpoint));
const specifiedPercent = all.size ? Math.round((specified.length / all.size) * 1000) / 10 : 100;

test(`OpenAPI lists ${covered.length} of ${all.size} operations (${percent}%), ${specified.length} fully specified (${specifiedPercent}%), and neither drops below its floor`, () => {
  const floorPath = join(root, 'contracts/coverage-floor.json');
  if (process.env.COVERAGE_UPDATE === '1') {
    writeFileSync(floorPath, `${JSON.stringify({ percent, specifiedPercent, covered: covered.length, specified: specified.length, total: all.size }, null, 2)}\n`);
    return;
  }
  const floor = JSON.parse(readFileSync(floorPath, 'utf8')) as { percent: number; specifiedPercent: number };
  assert.ok(percent >= floor.percent, `Contract coverage fell to ${percent}% (floor ${floor.percent}%). Document the new route in contracts/openapi.json, or run COVERAGE_UPDATE=1 only if routes were genuinely removed.`);
  assert.ok(specifiedPercent >= floor.specifiedPercent, `Fully specified operations fell to ${specifiedPercent}% (floor ${floor.specifiedPercent}%).`);
});

test('every documented operation that has a matching router is reachable (the contract does not describe ghosts)', () => {
  // Contract-only paths (other routers, control plane) are allowed; this guards the routers measured above.
  const measuredPrefixes = new Set([...all].map((endpoint) => endpoint.split(' ')[1].split('/')[1]));
  const ghosts = [...documented].filter((endpoint) => {
    const first = endpoint.split(' ')[1].split('/')[1];
    return measuredPrefixes.has(first) && !all.has(endpoint);
  });
  assert.deepEqual(ghosts, [], `documented but not served: ${ghosts.join(', ')}`);
});

if (process.env.COVERAGE_REPORT === '1') {
  const missing = [...all].filter((endpoint) => !documented.has(endpoint)).sort();
  console.log(`UNDOCUMENTED (${missing.length}):\n${missing.join('\n')}`);
}
