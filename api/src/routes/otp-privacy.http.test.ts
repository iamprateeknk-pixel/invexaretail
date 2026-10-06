// Plan Area D WP3: POST /auth/send-otp must not reveal whether an email is
// registered, inactive, or in a suspended company. It used to answer 404 "User not
// found" / 403 "inactive" / 403 "suspended" versus 200 for a real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword } from '../lib/otp-auth.js';
import { createEnhancedUser, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { setOtpSmtpSender } from '../lib/otp-auth.js';
import { clearOtpChallenge } from '../lib/session-store.js';
import enterpriseAuthRouter from './enterprise-auth.js';

async function withServer(run: (send: (email: string) => Promise<{ status: number; body: any }>, sent: string[]) => Promise<void>) {
  process.env.SMTP_HOST = 'smtp.test.invalid';
  const sent: string[] = [];
  setOtpSmtpSender(async (email) => { sent.push(email); });
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.set('trust proxy', true); // lets each request present a different client IP to the per-IP limiter
  app.use(express.json());
  app.use('/api/v1/auth', enterpriseAuthRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const send = async (email: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/send-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ email }) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(send, sent);
  } finally {
    setOtpSmtpSender(null);
    delete process.env.SMTP_HOST;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const unique = () => Math.random().toString(36).slice(2, 8);

test('unknown, inactive and active accounts get the identical public answer', async () => {
  await withServer(async (send, sent) => {
    const inactiveEmail = `inactive-${unique()}@example.com`;
    createEnhancedUser({ id: `u-${inactiveEmail}`, companyId: 'company-x', email: inactiveEmail, name: 'Off', role: 'STORE_USER', branchIds: [], locationIds: [], passwordHash: 'x', status: 'inactive' });

    const unknown = await send(`nobody-${unique()}@example.com`);
    const inactive = await send(inactiveEmail);
    const active = await send('admin@retail.local');

    for (const reply of [unknown, inactive, active]) assert.equal(reply.status, 200);
    const shape = (body: any) => Object.keys(body).sort().join(',');
    assert.equal(shape(unknown.body), shape(inactive.body));
    assert.equal(shape(unknown.body), shape(active.body));
    assert.equal(unknown.body.message, active.body.message);
    assert.equal(inactive.body.message, active.body.message);
    assert.doesNotMatch(unknown.body.message, /not found|inactive|suspended/i);
    await clearOtpChallenge('admin@retail.local', 'LOGIN');
  });
});

test('only the eligible active account is actually emailed a code', async () => {
  await withServer(async (send, sent) => {
    const inactiveEmail = `inactive-${unique()}@example.com`;
    createEnhancedUser({ id: `u-${inactiveEmail}`, companyId: 'company-x', email: inactiveEmail, name: 'Off', role: 'STORE_USER', branchIds: [], locationIds: [], passwordHash: 'x', status: 'inactive' });
    const ghost = `nobody-${unique()}@example.com`;
    await send(ghost);
    await send(inactiveEmail);
    await send('admin@retail.local');
    await new Promise((resolve) => setTimeout(resolve, 50)); // delivery runs in the background
    assert.deepEqual(sent, ['admin@retail.local']);
    await clearOtpChallenge('admin@retail.local', 'LOGIN');
  });
});

test('a malformed email is still a 400 (that tells nothing about accounts)', async () => {
  await withServer(async (send) => {
    assert.equal((await send('not-an-email')).status, 400);
  });
});

test('with no delivery configured every caller gets the same 503, not a per-account answer', async () => {
  await withServer(async (send) => {
    delete process.env.SMTP_HOST;
    const known = await send('admin@retail.local');
    const unknown = await send(`nobody-${unique()}@example.com`);
    assert.equal(known.status, 503);
    assert.equal(unknown.status, 503);
    assert.deepEqual(known.body, unknown.body);
  });
});
