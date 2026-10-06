import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { gunzipSync } from 'node:zlib';
import { responseCompression } from './response-compression.js';

async function withApp(run: (get: (path: string, headers?: Record<string, string>) => Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>) => Promise<void>) {
  const app = express();
  app.use(responseCompression);
  app.get('/big', (_req, res) => res.json({ rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: 'Basmati rice 5kg', status: 'ACTIVE' })) }));
  app.get('/small', (_req, res) => res.json({ ok: true }));
  app.get('/events', (_req, res) => {
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.write(`data: ${'x'.repeat(4000)}\n\n`);
    res.end();
  });
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  // node's http client does not auto-decompress, so the raw bytes are visible
  const get = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      http.get({ port, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  try {
    await run(get);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a large JSON response is gzipped when the client accepts it, and shrinks a lot', async () => {
  await withApp(async (get) => {
    const plain = await get('/big');
    const gz = await get('/big', { 'Accept-Encoding': 'gzip' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.deepEqual(JSON.parse(gunzipSync(gz.body).toString()), JSON.parse(plain.body.toString()));
    assert.ok(gz.body.length < plain.body.length / 5, `gzip ${gz.body.length} vs plain ${plain.body.length}`);
  });
});

test('tiny responses are left alone (below the threshold)', async () => {
  await withApp(async (get) => {
    assert.equal((await get('/small', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
  });
});

test('server-sent events are never compressed', async () => {
  await withApp(async (get) => {
    const res = await get('/events', { 'Accept-Encoding': 'gzip' });
    assert.equal(res.headers['content-encoding'], undefined);
    assert.match(res.body.toString(), /^data: x+/);
  });
});

test('a client can opt out with X-No-Compression', async () => {
  await withApp(async (get) => {
    assert.equal((await get('/big', { 'Accept-Encoding': 'gzip', 'X-No-Compression': '1' })).headers['content-encoding'], undefined);
  });
});
