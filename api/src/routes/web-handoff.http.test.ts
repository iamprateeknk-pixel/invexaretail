// Release checklist (Android): "No second login for a capability shown inside the signed-in app."
// The native app trades its signed-in session for a one-time code, opens the web workspace at
// #/handoff?code=..., and the web app trades the code for its own session. The access token never
// appears in a URL; a code works once, expires, and cannot be redeemed for the other handoff purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generateJWT, hashPassword } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { createHandoff } from '../lib/saas/session-handoff.js';
import enterpriseAuthRouter from './enterprise-auth.js';

async function withServer(run: (url: string) => Promise<void>) {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/v1/auth', enterpriseAuthRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}/api/v1/auth`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

let ipCounter = 10;
const post = async (url: string, path: string, body: unknown, token?: string) => {
  ipCounter += 1; // each call looks like a different client to the per-IP limiter
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.0.${ipCounter}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
};

test('a signed-in session gets a code, and the code buys a fresh session for the same user - once', async () => {
  await withServer(async (url) => {
    const admin = findUserByEmail('admin@retail.local')!;
    const token = generateJWT(admin.id, admin.companyId);

    const issued = await post(url, '/web-handoff', {}, token);
    assert.equal(issued.status, 201);
    assert.ok(issued.body.code.length >= 43);
    assert.equal(JSON.stringify(issued.body).includes(token), false, 'the code response never echoes the access token');
    assert.equal(issued.headers.get('cache-control'), 'no-store');

    const exchanged = await post(url, '/web-handoff/exchange', { code: issued.body.code });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.body));
    assert.equal(exchanged.body.user.email, 'admin@retail.local');
    assert.ok(exchanged.body.token && exchanged.body.token !== token, 'the web app gets its own new access token');
    assert.match(exchanged.headers.get('set-cookie') ?? '', /HttpOnly/i, 'and its refresh credential is an HttpOnly cookie');

    const replay = await post(url, '/web-handoff/exchange', { code: issued.body.code });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'HANDOFF_INVALID');
  });
});

test('issuing a code needs a signed-in session; garbage and unknown codes are rejected alike', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, '/web-handoff', {})).status, 401);
    for (const code of ['', 'short', 'x'.repeat(60)]) assert.equal((await post(url, '/web-handoff/exchange', { code })).status, 401);
  });
});

test('a code minted for the Control Plane cannot be redeemed as a web session, and vice versa', async () => {
  await withServer(async (url) => {
    const admin = findUserByEmail('admin@retail.local')!;
    const controlCode = createHandoff({ controlToken: 'x' }, Date.now(), 'control').code;
    assert.equal((await post(url, '/web-handoff/exchange', { code: controlCode })).status, 401, 'wrong purpose');

    const webCode = createHandoff({ userId: admin.id }, Date.now(), 'web').code;
    const { redeemHandoff } = await import('../lib/saas/session-handoff.js');
    assert.equal(redeemHandoff(webCode, Date.now(), 'control'), null, 'a web code is useless for the control exchange');
  });
});

test('a code for a user who has since been deactivated no longer opens a session', async () => {
  await withServer(async (url) => {
    const user = findUserByEmail('admin@retail.local')!;
    const code = createHandoff({ userId: user.id }, Date.now(), 'web').code;
    const original = user.status;
    user.status = 'inactive';
    try {
      assert.equal((await post(url, '/web-handoff/exchange', { code })).status, 401);
    } finally {
      user.status = original;
    }
  });
});
