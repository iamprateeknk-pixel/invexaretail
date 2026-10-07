import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { publishEvent, resetEventBusForTests } from '../lib/event-bus.js';
import { extractToken } from './enterprise-auth.js';
import eventsRouter from './events.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

function userFor(email: string) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return user;
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', eventsRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// Reads the SSE stream until `done` says the accumulated text is enough.
async function readStream(url: string, token: string, done: (text: string) => boolean, headers: Record<string, string> = {}, path = '/api/v1/events') {
  const controller = new AbortController();
  const response = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    while (!done(text)) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return text;
}


// Release checklist: "Event-to-visible freshness SLO passes during reconnect tests". The SLO asserted here:
// a published event reaches a connected client well inside the freshness budget, and a client that drops
// and reconnects with its last event id receives exactly the events it missed - in order, none twice, none lost.
const FRESHNESS_P95_BUDGET_MS = 250;

function parseFrames(text: string): Array<{ id: number; topic: string; at: number }> {
  return text.split('\n\n').flatMap((block) => {
    const id = /^id: (\d+)$/m.exec(block);
    const topic = /^event: (.+)$/m.exec(block);
    return id && topic && topic[1] !== 'hello' ? [{ id: Number(id[1]), topic: topic[1], at: Date.now() }] : [];
  });
}

test('a published event reaches a connected client inside the freshness budget (p95)', async () => {
  resetEventBusForTests();
  const user = userFor('admin@retail.local');
  const token = generateJWT(user.id, user.companyId);
  await withServer(async (url) => {
    const controller = new AbortController();
    const response = await fetch(`${url}/api/v1/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const seen = new Map<number, number>();
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const frame of parseFrames(blocks.join('\n\n') + '\n\n')) seen.set(frame.id, Date.now());
        }
      } catch { /* aborted */ }
    })();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sentAt = new Map<number, number>();
    for (let i = 0; i < 60; i += 1) {
      const event = publishEvent({ topic: 'stock.changed', companyId: user.companyId });
      sentAt.set(event.id, Date.now());
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    await pump;
    const latencies = [...sentAt].map(([id, sent]) => (seen.get(id) ?? Infinity) - sent).sort((a, b) => a - b);
    assert.equal(latencies.filter((ms) => !Number.isFinite(ms)).length, 0, 'every published event must be delivered');
    const p95 = latencies[Math.ceil(0.95 * latencies.length) - 1];
    assert.ok(p95 <= FRESHNESS_P95_BUDGET_MS, `event-to-client p95 ${p95}ms exceeds the ${FRESHNESS_P95_BUDGET_MS}ms budget`);
  });
});

test('after a dropped connection the client gets exactly the events it missed, in order, once', async () => {
  resetEventBusForTests();
  const user = userFor('admin@retail.local');
  const token = generateJWT(user.id, user.companyId);
  await withServer(async (url) => {
    const first = publishEvent({ topic: 'stock.changed', companyId: user.companyId });
    const second = publishEvent({ topic: 'stock.changed', companyId: user.companyId });
    const live = await readStream(url, token, (text) => parseFrames(text).length >= 0 && text.includes('event: hello'), { 'Last-Event-ID': String(first.id - 1) });
    const lastSeen = Math.max(...parseFrames(live).map((frame) => frame.id), first.id - 1);
    assert.ok(lastSeen >= first.id, 'the first connection replays what it had not yet seen');
    assert.equal(lastSeen, second.id);

    // The connection is gone; five events happen while the client is away.
    const missed = Array.from({ length: 5 }, () => publishEvent({ topic: 'transfer.changed', companyId: user.companyId }));
    const startedAt = Date.now();
    const replay = await readStream(url, token, (text) => parseFrames(text).length >= 5, { 'Last-Event-ID': String(lastSeen) });
    const elapsed = Date.now() - startedAt;
    const ids = parseFrames(replay).map((frame) => frame.id);
    assert.deepEqual(ids, missed.map((event) => event.id), 'exactly the missed events, in publish order, each once');
    assert.ok(elapsed <= 1000, `reconnect replay took ${elapsed}ms, over the 1000ms budget`);
  });
});
