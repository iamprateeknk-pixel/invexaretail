// Phase 4, step 0 (plan §4.1): golden route tables, added BEFORE any
// god-file split so every extraction commit has a mechanical parity oracle.
//
// For each router below, this test walks the live router stack (Express
// router internals: layer.route.path + layer.route.methods, in stack order,
// which is registration order) and asserts the ordered list of
// "METHOD path" pairs deep-equals the frozen golden snapshot in
// route-table.golden.ts. It catches what a moves-only refactor must never
// do: drop a route, duplicate one, typo a path, or reorder registrations —
// including the load-bearing orders inside core.ts (GET /imports/batches
// before GET /imports/:batchToken; DELETE /count-assignments/bulk before
// DELETE /count-assignments/:assignmentId).
//
// The golden lists were derived by reading the three route modules
// top-to-bottom on feat/advance-10x-phase4 (Phase 3 HEAD d16da45d). One
// count needs explaining: the Phase 4 plan (§1) credits core.ts with 77
// routes, and 77 is exactly the number of static registration statements
// with a literal path in that file. The live stack has 80 entries, because
// the TEMPLATE_ROUTES loop registers GET /imports/<kind>/template three
// times (opening-stock, sales, purchases) from a single statement — the
// plan itself (§4.1) notes those generated routes "appear in the stack
// like any other registration". The golden therefore records 80 for core:
// stack truth, not statement count. operations-extension.ts has 89 (no
// generated routes; plan agrees), and the control-plane module's three
// routers total 69 (control 34 + studio 30 + sync 5; plan agrees).
//
// Paths are router-relative, exactly as registered: index.ts mounts the
// core and operations-extension routers flat at /api/v1, and the
// control-plane routers at /control/v1, /studio/v1 and /sync/v1.
// index.ts itself is deliberately not imported here — it starts the
// server (the same constraint public-route-order.test.ts documents).
//
// route-auth-coverage.test.ts also walks router stacks, but only to probe
// that routes refuse credential-less callers; it snapshots nothing, so it
// cannot catch route drift. This test is the parity oracle; that one is
// the auth oracle. Both must keep passing.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Router } from 'express';
import coreRouter from './core.js';
import operationsExtensionRouter from './operations-extension.js';
import { controlRouter, studioRouter, syncRouter } from './control-plane.js';
import {
  CORE_ROUTES,
  OPERATIONS_EXTENSION_ROUTES,
  CONTROL_ROUTES,
  STUDIO_ROUTES,
  SYNC_ROUTES,
} from './route-table.golden.js';

type RouteLayer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
};

function routeTable(router: Router): string[] {
  const table: string[] = [];
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      for (const method of Object.keys(layer.route.methods)) {
        table.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return table;
}

test('core router registers exactly the golden routes, in order', () => {
  assert.deepEqual(routeTable(coreRouter), CORE_ROUTES);
});

test('operations-extension router registers exactly the golden routes, in order', () => {
  assert.deepEqual(routeTable(operationsExtensionRouter), OPERATIONS_EXTENSION_ROUTES);
});

test('control router registers exactly the golden routes, in order', () => {
  assert.deepEqual(routeTable(controlRouter), CONTROL_ROUTES);
});

test('studio router registers exactly the golden routes, in order', () => {
  assert.deepEqual(routeTable(studioRouter), STUDIO_ROUTES);
});

test('sync router registers exactly the golden routes, in order', () => {
  assert.deepEqual(routeTable(syncRouter), SYNC_ROUTES);
});
