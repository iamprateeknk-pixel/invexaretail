// Phase 7: POST /saas/onboard used to create the new tenant's admin with the
// publicly known default password whenever none was supplied (and the web form
// pre-filled it). It now needs an explicit, policy-compliant password.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken } from './enterprise-auth.js';
import operationsExtensionRouter from './operations-extension.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';

type Api = (body: unknown) => Promise<{ status: number; body: any }>;

async function withServer(run: (onboard: Api) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const admin = findUserByEmail('admin@retail.local')!;
  const token = generateJWT(admin.id, admin.companyId);
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, enforceOperationalCompanyScope);
  app.use('/api/v1', operationsExtensionRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const onboard: Api = async (body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/saas/onboard`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(onboard);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const base = (suffix: string) => ({ companyName: `Acme ${suffix}`, adminName: 'New Admin', adminEmail: `new-admin-${suffix}@example.com`, planCode: 'starter' });

test('onboarding without a password is rejected, not given the default one', async () => {
  await withServer(async (onboard) => {
    const reply = await onboard(base('nopw'));
    assert.equal(reply.status, 400);
    assert.match(reply.body.message, /Password/i);
    assert.equal(findUserByEmail('new-admin-nopw@example.com'), undefined, 'no account may be created');
  });
});

test('a weak password is rejected', async () => {
  await withServer(async (onboard) => {
    assert.equal((await onboard({ ...base('weak'), password: 'short' })).status, 400);
    assert.equal((await onboard({ ...base('weak2'), password: 'alllowercase1' })).status, 400);
    assert.equal(findUserByEmail('new-admin-weak@example.com'), undefined);
  });
});

test('the well-known default password is rejected even though it passes the strength rules', async () => {
  await withServer(async (onboard) => {
    const reply = await onboard({ ...base('default'), password: 'ChangeMe123!' });
    assert.equal(reply.status, 400);
    assert.match(reply.body.message, /publicly known/);
    assert.equal(findUserByEmail('new-admin-default@example.com'), undefined);
  });
});

test('a strong, non-default password provisions the tenant admin', async () => {
  await withServer(async (onboard) => {
    const reply = await onboard({ ...base('ok'), password: 'Fresh-Temp-Pass-91' });
    assert.ok(reply.status >= 200 && reply.status < 300, `status ${reply.status}: ${JSON.stringify(reply.body)}`);
    assert.ok(findUserByEmail('new-admin-ok@example.com'));
  });
});
