// Plan P0-SYNC-003 on real Postgres: the unique (company, user, mutation id) claim is
// what makes replay exactly-once across replicas and restarts. Skipped unless
// TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { mutationIdempotency, pruneMutationReceipts } from './mutation-idempotency.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function withApp(run: (post: (id: string, body?: unknown, user?: string, company?: string) => Promise<{ status: number; body: any; replay: string | null }>, state: { runs: number }) => Promise<void>) {
  const state = { runs: 0 };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = String(req.headers['x-test-user']);
    req.companyId = String(req.headers['x-test-company']);
    next();
  });
  app.use(mutationIdempotency());
  app.post('/api/v1/move-stock', async (req, res) => {
    state.runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 80));
    return res.status(201).json({ moved: req.body.qty, run: state.runs });
  });
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const post = async (id: string, body: unknown = { qty: 3 }, user = 'u-1', company = 'co-1') => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/move-stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mutation-Id': id, 'x-test-user': user, 'x-test-company': company },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})), replay: response.headers.get('idempotent-replay') };
  };
  try {
    await run(post, state);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

integration('eight simultaneous retries of one mutation run the handler exactly once; the rest are 409 or replays', async () => {
  const id = `mut-${randomUUID()}`;
  await withApp(async (post, state) => {
    const replies = await Promise.all(Array.from({ length: 8 }, () => post(id)));
    assert.equal(state.runs, 1, `handler ran ${state.runs} times`);
    assert.equal(replies.filter((r) => r.status === 201 && r.replay === null).length, 1, 'exactly one real execution');
    for (const reply of replies) assert.ok([201, 409].includes(reply.status), `unexpected ${reply.status}`);
    const after = await post(id);
    assert.equal(after.status, 201);
    assert.equal(after.replay, 'true');
    assert.deepEqual(after.body, { moved: 3, run: 1 }, 'the stored original result');
    assert.equal(state.runs, 1);
  });
});

integration('the receipt survives a "restart": a fresh app instance still replays the stored result', async () => {
  const id = `mut-${randomUUID()}`;
  let firstBody: unknown;
  await withApp(async (post) => { firstBody = (await post(id)).body; });
  await withApp(async (post, state) => {
    const replay = await post(id);
    assert.equal(replay.replay, 'true');
    assert.deepEqual(replay.body, firstBody);
    assert.equal(state.runs, 0, 'the new process never executed the mutation');
  });
});

integration('receipts are isolated per company and per user', async () => {
  const id = `mut-${randomUUID()}`;
  await withApp(async (post, state) => {
    await post(id, { qty: 3 }, 'u-1', 'co-1');
    await post(id, { qty: 3 }, 'u-2', 'co-1');
    await post(id, { qty: 3 }, 'u-1', 'co-2');
    assert.equal(state.runs, 3, 'the same id value from another user or company is a different mutation');
    assert.equal(await prisma.mutationReceipt.count({ where: { mutationId: id } }), 3);
  });
});

integration('a reused id with a different body is rejected and does not touch the stored result', async () => {
  const id = `mut-${randomUUID()}`;
  await withApp(async (post, state) => {
    await post(id, { qty: 3 });
    const reused = await post(id, { qty: 500 });
    assert.equal(reused.status, 422);
    assert.equal(state.runs, 1);
    const row = await prisma.mutationReceipt.findFirstOrThrow({ where: { mutationId: id } });
    assert.equal(row.state, 'DONE');
    assert.ok(row.responseBody?.includes('"moved":3'));
  });
});

integration('prune removes only receipts older than the retention window', async () => {
  const oldId = `mut-old-${randomUUID()}`;
  const freshId = `mut-new-${randomUUID()}`;
  await prisma.mutationReceipt.create({ data: { companyId: 'co-prune', userId: 'u', mutationId: oldId, fingerprint: 'x', state: 'DONE', statusCode: 200, createdAt: new Date(Date.now() - 10 * 86_400_000) } });
  await prisma.mutationReceipt.create({ data: { companyId: 'co-prune', userId: 'u', mutationId: freshId, fingerprint: 'x', state: 'DONE', statusCode: 200 } });
  const removed = await pruneMutationReceipts(7);
  assert.ok(removed >= 1);
  assert.equal(await prisma.mutationReceipt.count({ where: { mutationId: oldId } }), 0);
  assert.equal(await prisma.mutationReceipt.count({ where: { mutationId: freshId } }), 1);
});
