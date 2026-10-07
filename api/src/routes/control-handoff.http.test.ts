import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Request } from 'express';
import { controlPlane } from '../lib/saas/control-plane.js';
import { LOCAL_STRIPE_SECRET, resetLocalStripeSessions, resetStripeTransport, setStripeTransport, signStripePayload } from '../lib/saas/billing-provider.js';
import { controlRouter, studioRouter, syncRouter } from './control-plane.js';

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  controlPlane.reset();
  const app = express();
  app.use(express.json({
    verify(req: Request, _res, buf: Buffer) {
      req.rawBody = buf.toString('utf8');
    },
  }));
  app.use('/control/v1', controlRouter);
  app.use('/studio/v1', studioRouter);
  app.use('/sync/v1', syncRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run(url);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function json(url: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}


async function lockedSession(url: string) {
  const login = await json(url, '/control/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword }),
  });
  const platformToken = login.body.token as string;
  const locked = await json(url, '/control/v1/sessions/select-company', {
    method: 'POST',
    headers: { Authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({ companyId: 'default-company' }),
  });
  return { platformToken, controlToken: locked.body.token as string, session: { platformToken, controlToken: locked.body.token, company: locked.body.company } };
}

test('HTTP: session handoff swaps a short one-time code for the session, once', async () => {
  await withServer(async (url) => {
    const { controlToken, session } = await lockedSession(url);
    const issued = await json(url, '/control/v1/sessions/handoff', {
      method: 'POST', headers: { Authorization: `Bearer ${controlToken}` }, body: JSON.stringify({ session }),
    });
    assert.equal(issued.status, 201);
    assert.ok(issued.body.code.length >= 43);
    assert.equal(JSON.stringify(issued.body).includes(controlToken), false, 'the code response never echoes the token');

    const exchanged = await json(url, '/control/v1/sessions/handoff/exchange', { method: 'POST', body: JSON.stringify({ code: issued.body.code }) });
    assert.equal(exchanged.status, 200);
    assert.equal(exchanged.body.session.controlToken, controlToken);

    const replay = await json(url, '/control/v1/sessions/handoff/exchange', { method: 'POST', body: JSON.stringify({ code: issued.body.code }) });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'HANDOFF_INVALID');
  });
});

test('HTTP: handoff refuses unauthenticated callers, a platform-only token, and a session that is not the callers own', async () => {
  await withServer(async (url) => {
    const { platformToken, controlToken, session } = await lockedSession(url);
    const anonymous = await json(url, '/control/v1/sessions/handoff', { method: 'POST', body: JSON.stringify({ session }) });
    assert.equal(anonymous.status, 401);
    const platformOnly = await json(url, '/control/v1/sessions/handoff', {
      method: 'POST', headers: { Authorization: `Bearer ${platformToken}` }, body: JSON.stringify({ session }),
    });
    assert.equal(platformOnly.status, 401, 'a handoff needs a hard-locked company session');
    const forged = await json(url, '/control/v1/sessions/handoff', {
      method: 'POST', headers: { Authorization: `Bearer ${controlToken}` }, body: JSON.stringify({ session: { ...session, controlToken: 'someone-elses-token' } }),
    });
    assert.equal(forged.status, 400);
    assert.equal(forged.body.code, 'INVALID_HANDOFF');
    const garbage = await json(url, '/control/v1/sessions/handoff/exchange', { method: 'POST', body: JSON.stringify({ code: 'not-a-real-code' }) });
    assert.equal(garbage.status, 401);
  });
});
