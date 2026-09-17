import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword, generateJWT } from '../lib/otp-auth.js';
import { seedEnhancedUsersForMemoryMode, findUserByEmail } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { extractToken, requireAuth } from './enterprise-auth.js';
import coreRouter from './core.js';
import { enforceOperationalCompanyScope } from '../lib/saas/tenant-scope.js';
import { enforceOperationalKillSwitches } from '../lib/saas/kill-switch.js';
import { controlPlane } from '../lib/saas/control-plane.js';

function tokenFor(email: string): string {
  const user = findUserByEmail(email);
  if (!user) throw new Error(`missing workspace user ${email}`);
  return generateJWT(user.id, user.companyId);
}

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.use(express.json());
  app.use('/api/v1', extractToken, requireAuth, enforceOperationalCompanyScope, enforceOperationalKillSwitches, coreRouter);
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

async function json(url: string, path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

test('HTTP: INVENTORY kill switch blocks item creates but still lists catalog', async () => {
  const platform = controlPlane.createScope({ actorId: 'platform-super-1', sessionType: 'platform' });
  controlPlane.setKillSwitch(platform, 'INVENTORY', false, 'http-test');
  try {
    await withServer(async (url) => {
      const grocery = tokenFor('admin@retail.local');
      const listed = await json(url, '/api/v1/items', grocery);
      assert.equal(listed.status, 200);
      assert.equal(Array.isArray(listed.body.items), true);

      const created = await json(url, '/api/v1/items', grocery, {
        method: 'POST',
        body: JSON.stringify({ code: 'SKU-KILL-1', name: 'Kill switch snack', unit: 'pack' }),
      });
      assert.equal(created.status, 403);
      assert.equal(created.body.code, 'KILL_SWITCH');
      assert.equal(created.body.feature, 'INVENTORY');

      controlPlane.setKillSwitch(platform, 'INVENTORY', true, 'http-test-restore');
      const restored = await json(url, '/api/v1/items', grocery, {
        method: 'POST',
        body: JSON.stringify({ code: `SKU-KILL-${Date.now()}`, name: 'Restored snack', unit: 'pack' }),
      });
      assert.equal(restored.status, 201);
      assert.equal(restored.body.success, true);
    });
  } finally {
    controlPlane.setKillSwitch(platform, 'INVENTORY', true, 'http-test-restore');
  }
});
