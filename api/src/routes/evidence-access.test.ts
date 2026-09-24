import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import evidenceAccessRouter from './evidence-access.js';
import { createSignedAccessToken } from '../lib/signed-access.js';

async function get(path: string): Promise<number> {
  const app = express();
  app.use('/api/v1', evidenceAccessRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bind failed');
  try {
    return (await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`)).status;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a garbage, expired or wrong-kind link never serves a file (404, not 401/500)', async () => {
  assert.equal(await get('/evidence-files/garbage'), 404);
  const expired = createSignedAccessToken({ kind: 'transfer-evidence', resource: 't/e', companyId: 'c1', ttlSeconds: 1 }, Date.now() - 60_000).token;
  assert.equal(await get(`/evidence-files/${expired}`), 404);
  const wrongKind = createSignedAccessToken({ kind: 'something-else', resource: 't/e', companyId: 'c1' }).token;
  assert.equal(await get(`/evidence-files/${wrongKind}`), 404);
});

test('a genuine link for a transfer that does not exist is still a 404 (no existence oracle)', async () => {
  const ok = createSignedAccessToken({ kind: 'transfer-evidence', resource: 'no-such-transfer/e1', companyId: 'c1' }).token;
  assert.equal(await get(`/evidence-files/${ok}`), 404);
});
