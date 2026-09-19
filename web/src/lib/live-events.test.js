import assert from 'node:assert/strict';
import test from 'node:test';
import { LIVE_STATUS, backoffDelay, createLiveClient, invalidationsForTopics, parseSseBuffer } from './live-events.js';

const encoder = new TextEncoder();

function streamResponse(chunks, { status = 200, holdOpen = false } = {}) {
  let index = 0;
  return {
    status,
    ok: status >= 200 && status < 300,
    body: {
      getReader() {
        return {
          async read() {
            if (index < chunks.length) return { value: encoder.encode(chunks[index++]), done: false };
            if (holdOpen) return new Promise(() => {});
            return { value: undefined, done: true };
          },
        };
      },
    },
  };
}

const frame = (id, topic) => `id: ${id}\nevent: ${topic}\ndata: {"id":${id},"topic":"${topic}"}\n\n`;
const hello = (epoch) => `event: hello\ndata: {"epoch":"${epoch}","latestEventId":0}\n\n`;

test('parseSseBuffer returns whole frames and keeps a partial tail', () => {
  const { frames, rest } = parseSseBuffer(`: ping\n\n${frame(1, 'stock.changed')}id: 2\nevent: count.chan`);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'stock.changed');
  assert.equal(frames[0].id, '1');
  assert.equal(rest, 'id: 2\nevent: count.chan');
  const next = parseSseBuffer(`${rest}ged\ndata: {}\n\n`);
  assert.equal(next.frames[0].event, 'count.changed');
});

test('backoff grows exponentially, is capped, and stays within jitter bounds', () => {
  assert.equal(backoffDelay(0, () => 0.5), 1000);
  assert.equal(backoffDelay(3, () => 0.5), 8000);
  assert.equal(backoffDelay(20, () => 0.5), 30000);
  assert.ok(backoffDelay(2, () => 0) >= 3200 && backoffDelay(2, () => 1) <= 4800);
});

test('topics map to targeted invalidations and unknown topics invalidate nothing', () => {
  assert.deepEqual([...invalidationsForTopics(['count.changed'])].sort(), ['assignments', 'counts', 'dashboard']);
  assert.ok(invalidationsForTopics(['stock.changed']).has('stock'));
  assert.ok(!invalidationsForTopics(['stock.changed']).has('items'));
  assert.ok(invalidationsForTopics(['permission.changed']).has('full'));
  assert.ok(invalidationsForTopics(['*']).has('items') && !invalidationsForTopics(['*']).has('full'));
  assert.equal(invalidationsForTopics(['something.else']).size, 0);
});

test('client dispatches events, tracks the cursor, drops duplicates and sends Last-Event-ID on reconnect', async () => {
  const requests = [];
  const batches = [];
  const statuses = [];
  let call = 0;
  let client;
  const fetchImpl = async (url, options) => {
    requests.push({ url, headers: options.headers });
    call += 1;
    if (call === 1) return streamResponse([hello('e1'), frame(1, 'stock.changed'), frame(2, 'count.changed'), frame(2, 'count.changed')]);
    client.stop();
    return streamResponse([], { holdOpen: true });
  };
  client = createLiveClient({
    url: 'http://x/api/v1/events',
    getToken: () => 'tok',
    fetchImpl,
    sleep: async () => {},
    onEvents: (topics) => batches.push(topics),
    onStatus: (status) => statuses.push(status),
  });
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(batches.flat(), ['stock.changed', 'count.changed']);
  assert.equal(client.cursor, 2);
  assert.equal(requests[0].headers.Authorization, 'Bearer tok');
  assert.equal(requests[0].headers['Last-Event-ID'], undefined);
  assert.equal(requests[1].headers['Last-Event-ID'], '2');
  assert.match(requests[1].url, /epoch=e1/);
  assert.ok(statuses.includes(LIVE_STATUS.live));
  assert.ok(statuses.includes(LIVE_STATUS.reconnecting));
});

test('a changed server epoch or an explicit reset asks for a full resync and clears the cursor', async () => {
  const batches = [];
  let call = 0;
  let client;
  client = createLiveClient({
    url: 'http://x/events',
    getToken: () => 'tok',
    sleep: async () => {},
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return streamResponse([hello('old'), frame(5, 'stock.changed')]);
      if (call === 2) return streamResponse([hello('new')]);
      if (call === 3) return streamResponse([hello('new'), 'event: reset\ndata: {}\n\n']);
      client.stop();
      return streamResponse([], { holdOpen: true });
    },
    onEvents: (topics) => batches.push(topics),
  });
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(batches.flat(), ['stock.changed', '*', '*']);
  assert.equal(client.cursor, null);
});

test('a 401 stops the client instead of hammering the server', async () => {
  let calls = 0;
  const statuses = [];
  const client = createLiveClient({
    url: 'http://x/events',
    getToken: () => 'expired',
    sleep: async () => {},
    fetchImpl: async () => { calls += 1; return streamResponse([], { status: 401 }); },
    onStatus: (status) => statuses.push(status),
  });
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  assert.equal(statuses.at(-1), LIVE_STATUS.unauthorized);
  client.stop();
});

test('a network failure retries with backoff instead of throwing', async () => {
  let calls = 0;
  const sleeps = [];
  let client;
  client = createLiveClient({
    url: 'http://x/events',
    getToken: () => 'tok',
    random: () => 0.5,
    sleep: async (ms) => { sleeps.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('network down');
      client.stop();
      return streamResponse([], { holdOpen: true });
    },
  });
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [2000, 4000]);
});
