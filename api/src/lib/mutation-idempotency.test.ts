// The X-Mutation-Id replay contract, in memory mode. Database-mode atomicity under
// concurrency is covered by mutation-idempotency.postgres.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mutationIdempotency, resetMutationReceiptsForTests, pruneMutationReceipts, STALE_IN_PROGRESS_MS } from './mutation-idempotency.js';

type Reply = { status: number; body: any; headers: Headers };

async function withApp(run: (post: (path: string, id: string | null, body?: unknown, user?: string) => Promise<Reply>, state: { runs: number }, get: (path: string, id: string) => Promise<Reply>) => Promise<void>, now: () => number = Date.now) {
  resetMutationReceiptsForTests();
  const state = { runs: 0 };
  const app = express();
  app.use(express.json());
  // stand-in for the auth layer: identity comes from test headers
  app.use((req, _res, next) => {
    const user = req.headers['x-test-user'];
    if (typeof user === 'string') { req.userId = user; req.companyId = req.headers['x-test-company'] as string ?? 'co-1'; }
    next();
  });
  app.use(mutationIdempotency(now));
  app.post('/api/v1/pay', async (req, res) => {
    state.runs += 1;
    if (req.body?.fail) return res.status(409).json({ message: 'conflict' });
    if (req.body?.slow) await new Promise((resolve) => setTimeout(resolve, 150));
    return res.status(201).json({ ok: true, runNumber: state.runs, amount: req.body?.amount });
  });
  app.get('/api/v1/read', (_req, res) => { state.runs += 1; res.json({ ok: true }); });
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const post = async (path: string, id: string | null, body: unknown = { amount: 5 }, user = 'u1'): Promise<Reply> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': user, ...(id ? { 'X-Mutation-Id': id } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
  };
  const get = async (path: string, id: string): Promise<Reply> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-test-user': 'u1', 'X-Mutation-Id': id } });
    return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
  };
  try {
    await run(post, state, get);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a retry with the same mutation id replays the stored result and does not run the handler again', async () => {
  await withApp(async (post, state) => {
    const first = await post('/api/v1/pay', 'mutation-0001');
    assert.equal(first.status, 201);
    assert.equal(first.headers.get('idempotent-replay'), null);
    const retry = await post('/api/v1/pay', 'mutation-0001');
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get('idempotent-replay'), 'true');
    assert.deepEqual(retry.body, first.body, 'the original result, including its run number');
    assert.equal(state.runs, 1, 'one business side effect');
  });
});

test('requests without the header behave exactly as before, every time', async () => {
  await withApp(async (post, state) => {
    await post('/api/v1/pay', null);
    await post('/api/v1/pay', null);
    assert.equal(state.runs, 2);
  });
});

test('different ids run independently; the same id is scoped per user and per company', async () => {
  await withApp(async (post, state) => {
    await post('/api/v1/pay', 'mutation-0001');
    await post('/api/v1/pay', 'mutation-0002');
    assert.equal(state.runs, 2);
    await post('/api/v1/pay', 'mutation-0001', { amount: 5 }, 'someone-else');
    assert.equal(state.runs, 3, 'another user reusing the id value is not a replay');
  });
});

test('reusing an id for a different request is rejected, not silently replayed', async () => {
  await withApp(async (post, state) => {
    await post('/api/v1/pay', 'mutation-0001', { amount: 5 });
    const reused = await post('/api/v1/pay', 'mutation-0001', { amount: 999 });
    assert.equal(reused.status, 422);
    assert.equal(reused.body.code, 'MUTATION_ID_REUSED');
    assert.equal(state.runs, 1);
  });
});

test('a failed attempt releases the id so the retry really runs', async () => {
  await withApp(async (post, state) => {
    const failed = await post('/api/v1/pay', 'mutation-0001', { fail: true });
    assert.equal(failed.status, 409);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const retry = await post('/api/v1/pay', 'mutation-0001', { fail: true });
    assert.equal(retry.status, 409);
    assert.equal(state.runs, 2, 'a non-2xx result is never remembered as the outcome');
  });
});

test('a concurrent duplicate gets 409 MUTATION_IN_PROGRESS with Retry-After, and the handler runs once', async () => {
  await withApp(async (post, state) => {
    const [a, b] = await Promise.all([post('/api/v1/pay', 'mutation-0001', { amount: 1, slow: true }), post('/api/v1/pay', 'mutation-0001', { amount: 1, slow: true })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const loser = a.status === 409 ? a : b;
    assert.equal(loser.body.code, 'MUTATION_IN_PROGRESS');
    assert.equal(loser.headers.get('retry-after'), '2');
    assert.equal(state.runs, 1);
  });
});

test('malformed ids are rejected up front', async () => {
  await withApp(async (post, state) => {
    assert.equal((await post('/api/v1/pay', 'short')).status, 400);
    assert.equal((await post('/api/v1/pay', 'has spaces in it!!')).status, 400);
    assert.equal(state.runs, 0);
  });
});

test('GET requests are never intercepted, even with the header', async () => {
  await withApp(async (_post, state, get) => {
    await get('/api/v1/read', 'mutation-0001');
    await get('/api/v1/read', 'mutation-0001');
    assert.equal(state.runs, 2);
  });
});

test('an abandoned in-progress claim is taken over after the stale window', async () => {
  let clock = 1_000_000;
  await withApp(async (post, state) => {
    // simulate a crash mid-handler: the first call claims, never settles
    const hung = post('/api/v1/pay', 'mutation-0001', { amount: 1, slow: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    clock += STALE_IN_PROGRESS_MS + 1_000;
    const takeover = await post('/api/v1/pay', 'mutation-0001', { amount: 1 });
    assert.equal(takeover.status, 201, 'the stuck claim does not block this mutation forever');
    await hung;
    assert.ok(state.runs >= 2);
  }, () => clock);
});

test('old receipts are pruned after the retention window', async () => {
  await withApp(async (post) => {
    await post('/api/v1/pay', 'mutation-0001');
    assert.equal(await pruneMutationReceipts(7, Date.now()), 0, 'recent receipts stay');
    assert.equal(await pruneMutationReceipts(7, Date.now() + 8 * 86_400_000), 1);
  });
});
