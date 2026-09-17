import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

import { MEMORY_MODE_UNAVAILABLE, isMemoryImplementedPath, memoryGetPayload, respondWhenMemoryUnavailable } from './memory-mode.js';

function invokeMemoryGuard(method: string, path: string) {
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const req = { method, path, url: path } as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as Response;
  const next = (() => { nextCalled = true; }) as NextFunction;
  respondWhenMemoryUnavailable(req, res, next);
  return { statusCode, body, nextCalled };
}

test('memory mode returns empty collections for dashboard Prisma GETs', () => {
  assert.deepEqual(memoryGetPayload('/asset-checkouts'), { checkouts: [] });
  assert.deepEqual(memoryGetPayload('/jobs'), { jobs: [] });
  assert.deepEqual(memoryGetPayload('/orders'), { orders: [] });
  assert.deepEqual(memoryGetPayload('/catalog/tags'), { tags: [] });
  assert.deepEqual(memoryGetPayload('/catalog/custom-fields'), { fields: [] });
  assert.deepEqual(memoryGetPayload('/notification-inbox'), { notifications: [] });
  assert.equal(memoryGetPayload('/expiry-board'), null);
  assert.equal(memoryGetPayload('/reorder-rules'), null);
  assert.deepEqual(memoryGetPayload('/catalog/items/item-1'), { tags: [], customFields: [] });
  assert.deepEqual(memoryGetPayload('/comments/item/item-1'), { comments: [] });
});

test('expiry and replenishment paths are implemented in memory mode', () => {
  assert.equal(isMemoryImplementedPath('/expiry-board', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/expiry-write-off', 'POST'), true);
  assert.equal(isMemoryImplementedPath('/lots/lot-1/expiry', 'PATCH'), true);
  assert.equal(isMemoryImplementedPath('/lots/lot-1/status', 'PATCH'), true);
  assert.equal(isMemoryImplementedPath('/reorder-rules', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/reorder-rules/item-1001', 'PUT'), true);
  assert.equal(isMemoryImplementedPath('/intelligence/loc-1', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/webhook-subscriptions', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/webhook-subscriptions', 'POST'), true);
  assert.equal(isMemoryImplementedPath('/webhook-subscriptions/hook-1/status', 'PATCH'), true);
  assert.equal(isMemoryImplementedPath('/webhook-deliveries', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/saas/plans', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/connectors', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/mobile/home', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/qc-templates', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/qc-inspections', 'POST'), true);
  assert.equal(isMemoryImplementedPath('/orders', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/orders', 'POST'), true);
  assert.equal(invokeMemoryGuard('GET', '/orders').nextCalled, true);
  assert.equal(invokeMemoryGuard('POST', '/orders').nextCalled, true);
  assert.equal(isMemoryImplementedPath('/locations/loc-1/bin-stock', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/locations/loc-1/bins', 'GET'), true);
  assert.equal(isMemoryImplementedPath('/locations/loc-1/bins', 'POST'), true);
  assert.equal(invokeMemoryGuard('GET', '/locations/loc-1/bins').nextCalled, true);
  assert.equal(invokeMemoryGuard('GET', '/expiry-board').nextCalled, true);
  assert.equal(invokeMemoryGuard('POST', '/expiry-write-off').nextCalled, true);
  assert.equal(invokeMemoryGuard('GET', '/reorder-rules').nextCalled, true);
  assert.equal(invokeMemoryGuard('PUT', '/reorder-rules/item-1001').nextCalled, true);
  assert.equal(invokeMemoryGuard('GET', '/intelligence/loc-1').nextCalled, true);
  assert.equal(invokeMemoryGuard('POST', '/webhook-subscriptions').nextCalled, true);
  assert.equal(invokeMemoryGuard('GET', '/webhook-deliveries').nextCalled, true);
});

test('unknown Prisma paths stay unavailable in memory mode', () => {
  assert.equal(memoryGetPayload('/jobs/job-1'), null);
  assert.equal(MEMORY_MODE_UNAVAILABLE.code, 'MEMORY_MODE');
});

test('memory-mode middleware returns empty dashboard lists instead of querying Prisma', () => {
  assert.equal(Boolean(process.env.DATABASE_URL), false);
  const jobs = invokeMemoryGuard('GET', '/jobs');
  assert.equal(jobs.nextCalled, false);
  assert.deepEqual(jobs.body, { jobs: [] });
  const checkouts = invokeMemoryGuard('GET', '/asset-checkouts');
  assert.deepEqual(checkouts.body, { checkouts: [] });
});

test('memory-mode middleware rejects writes with 501', () => {
  const created = invokeMemoryGuard('POST', '/jobs');
  assert.equal(created.statusCode, 501);
  assert.deepEqual(created.body, {
    message: MEMORY_MODE_UNAVAILABLE.message,
    code: MEMORY_MODE_UNAVAILABLE.code,
  });
});

test('runtime persistence keys off DATABASE_URL, not PERSISTENCE_MODE', () => {
  const persistence = readFileSync(join(process.cwd(), 'src/lib/persistence.ts'), 'utf8');
  const index = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');
  assert.equal(persistence.includes('PERSISTENCE_MODE'), false);
  assert.equal(index.includes('PERSISTENCE_MODE'), false);
});
