import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { SERVER_EPOCH, canReceive, eventsSince, publishEvent, resetEventBusForTests } from '../lib/event-bus.js';
import { locationIdsForMutation, topicsForMutation } from '../lib/event-topics.js';
import { extractToken } from './enterprise-auth.js';
import coreRouter from './core.js';
import eventsRouter, { publishMutationEvents } from './events.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

function userFor(email: string) {
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
  app.use('/api/v1', publishMutationEvents);
  app.use('/api/v1', coreRouter);
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

test('topicsForMutation maps successful writes to blueprint topics and ignores reads/previews', () => {
  assert.deepEqual(topicsForMutation('GET', '/items'), []);
  assert.deepEqual(topicsForMutation('POST', '/imports/sales/preview'), []);
  assert.deepEqual(topicsForMutation('POST', '/items'), ['item.changed']);
  assert.deepEqual(topicsForMutation('POST', '/stock-counts'), ['count.changed']);
  assert.deepEqual(new Set(topicsForMutation('POST', '/stock-counts/c1/review')), new Set(['count.changed', 'stock.changed']));
  assert.deepEqual(new Set(topicsForMutation('POST', '/transfers/t1/receive')), new Set(['transfer.changed', 'stock.changed', 'receipt.changed']));
  assert.deepEqual(new Set(topicsForMutation('POST', '/imports/sales/commit')), new Set(['import.committed', 'stock.changed']));
  assert.deepEqual(topicsForMutation('PUT', '/users/u1/permissions'), ['permission.changed']);
  assert.deepEqual(topicsForMutation('POST', '/unknown-thing'), []);
});

test('locationIdsForMutation reads locations from the path and body', () => {
  assert.equal(locationIdsForMutation('/items', {}), undefined);
  assert.deepEqual(locationIdsForMutation('/locations/loc-1/bin-transfers', {}), ['loc-1']);
  assert.deepEqual(
    new Set(locationIdsForMutation('/transfers', { sourceLocationId: 'a', destinationLocationId: 'b' })),
    new Set(['a', 'b']),
  );
});

test('canReceive scopes events by company and location', () => {
  const event = { id: 1, topic: 'stock.changed' as const, companyId: 'c1', locationIds: ['loc-1'], at: '' };
  assert.equal(canReceive({ companyId: 'c1', locationIds: null }, event), true);
  assert.equal(canReceive({ companyId: 'c1', locationIds: ['loc-1', 'loc-2'] }, event), true);
  assert.equal(canReceive({ companyId: 'c1', locationIds: ['loc-9'] }, event), false);
  assert.equal(canReceive({ companyId: 'c2', locationIds: null }, event), false);
  assert.equal(canReceive({ companyId: 'c1', locationIds: ['loc-9'] }, { ...event, locationIds: undefined }), true);
});

test('eventsSince replays after a cursor and resets on stale or foreign cursors', () => {
  resetEventBusForTests();
  const sub = { companyId: 'c1', locationIds: null };
  publishEvent({ topic: 'stock.changed', companyId: 'c1' });
  publishEvent({ topic: 'count.changed', companyId: 'c1' });
  publishEvent({ topic: 'item.changed', companyId: 'other' });

  const replay = eventsSince(1, sub);
  assert.equal(replay.kind, 'replay');
  assert.deepEqual(replay.kind === 'replay' ? replay.events.map((e) => e.topic) : [], ['count.changed']);
  assert.equal(eventsSince(99, sub).kind, 'reset');
  assert.equal(eventsSince(0, sub, 'some-old-epoch').kind, 'reset');
  assert.equal(eventsSince(3, sub, SERVER_EPOCH).kind, 'replay');
});

test('HTTP: stream requires auth', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/api/v1/events`);
    assert.equal(response.status, 401);
  });
});

test('HTTP: a committed mutation is pushed to an open stream, and a reconnect replays what was missed', async () => {
  resetEventBusForTests();
  await withServer(async (url) => {
    const admin = userFor('admin@retail.local');
    const token = generateJWT(admin.id, admin.companyId);

    const listening = readStream(url, token, (text) => text.includes('event: item.changed'));
    // Give the stream a moment to register before mutating.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const create = await fetch(`${url}/api/v1/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: `LIVE-${Date.now()}`, name: 'Live sync item' }),
    });
    assert.equal(create.status, 201);
    const live = await listening;
    assert.match(live, /event: hello/);
    assert.match(live, /event: item\.changed/);

    // A failed mutation must publish nothing.
    const before = live.match(/event: item\.changed/g)?.length ?? 0;
    const bad = await fetch(`${url}/api/v1/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'no code' }),
    });
    assert.ok(bad.status >= 400);

    // Reconnect from cursor 0: the earlier item.changed comes back as a replay.
    const replayed = await readStream(url, token, (text) => text.includes('event: item.changed'), { 'Last-Event-ID': '0' });
    assert.match(replayed, /event: item\.changed/);
    assert.equal(replayed.match(/event: item\.changed/g)?.length, before);

    // A cursor from the future (server restarted) asks the client to resync everything.
    const reset = await readStream(url, token, (text) => text.includes('event: reset'), { 'Last-Event-ID': '99999' });
    assert.match(reset, /event: reset/);
  });
});

test('HTTP: closed streams release their per-user slot, so a flaky connection never locks a user out of live updates', async () => {
  resetEventBusForTests();
  await withServer(async (url) => {
    const admin = userFor('admin@retail.local');
    const token = generateJWT(admin.id, admin.companyId);
    // Well past MAX_STREAMS_PER_USER (5): each stream is opened, read to its hello frame, then dropped.
    for (let i = 0; i < 8; i += 1) {
      const text = await readStream(url, token, (t) => t.includes('event: hello'));
      assert.match(text, /event: hello/);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
});
