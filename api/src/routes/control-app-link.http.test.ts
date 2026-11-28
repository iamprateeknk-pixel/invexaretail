// Linked Control Panel sign-in (Windows app). A company ADMIN never gets the platform Control Panel
// on its role alone: a platform administrator links their account to one app user by proving both
// identities in one request, after which that app user can open the panel with a one-time code.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generateJWT, hashPassword } from '../lib/otp-auth.js';
import { findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import { controlPlane } from '../lib/saas/control-plane.js';
import { resetAppLinksForTest } from '../lib/saas/control-app-link.js';
import { clearFailures } from '../lib/login-lockout.js';
import enterpriseAuthRouter from './enterprise-auth.js';
import { controlRouter } from './control-plane.js';

async function withServer(run: (url: string) => Promise<void>) {
  controlPlane.reset();
  resetAppLinksForTest();
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/v1/auth', enterpriseAuthRouter);
  app.use('/control/v1', controlRouter);
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

let ipCounter = 10;
async function call(url: string, method: string, path: string, body?: unknown, token?: string) {
  ipCounter += 1; // each call looks like a different client to the per-IP limiter
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.8.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
}

const platform = () => ({ email: 'superadmin@invexa.local', password: controlPlane.seedPassword });
const tokenFor = (email: string) => {
  const user = findUserByEmail(email)!;
  return generateJWT(user.id, user.companyId);
};

test('link once with the platform password, then open the Control Panel signed in - one code, one use', async () => {
  await withServer(async (url) => {
    const admin = tokenFor('admin@retail.local');
    assert.equal((await call(url, 'GET', '/api/v1/auth/control-link', undefined, admin)).body.linked, false);
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin)).status, 404, 'no link, no panel session');

    const linked = await call(url, 'POST', '/api/v1/auth/control-link', platform(), admin);
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    assert.equal(linked.body.platformEmail, 'superadmin@invexa.local');
    assert.equal(JSON.stringify(linked.body).includes('token'), false, 'linking hands out no platform token');
    assert.equal((await call(url, 'GET', '/api/v1/auth/control-link', undefined, admin)).body.linked, true);

    const issued = await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin);
    assert.equal(issued.status, 201);
    assert.equal(issued.headers.get('cache-control'), 'no-store');
    const exchanged = await call(url, 'POST', '/control/v1/auth/app-link/exchange', { code: issued.body.code });
    assert.equal(exchanged.status, 200);
    assert.equal(exchanged.body.session.user.email, 'superadmin@invexa.local');
    const companies = await call(url, 'GET', '/control/v1/companies', undefined, exchanged.body.session.platformToken);
    assert.equal(companies.status, 200, 'the token is a real platform session');

    assert.equal((await call(url, 'POST', '/control/v1/auth/app-link/exchange', { code: issued.body.code })).status, 401, 'a code works once');
    const actions = controlPlane.audit.map((event) => event.action);
    assert.ok(actions.includes('APP_LINK_CREATED') && actions.includes('PLATFORM_LOGIN_LINKED'), 'link and linked sign-in are audited');
  });
});

test('a wrong platform password links nothing, and repeated guesses lock the attempt', async () => {
  await withServer(async (url) => {
    const admin = tokenFor('admin@retail.local');
    const user = findUserByEmail('admin@retail.local')!;
    await clearFailures(`control-link:${user.id}`);
    const wrong = await call(url, 'POST', '/api/v1/auth/control-link', { email: 'superadmin@invexa.local', password: 'not-it' }, admin);
    assert.equal(wrong.status, 400, 'not 401: the app session itself is valid and must not be refreshed');
    assert.equal((await call(url, 'GET', '/api/v1/auth/control-link', undefined, admin)).body.linked, false);
    let last = wrong;
    for (let attempt = 0; attempt < 12 && last.status !== 429; attempt += 1) {
      last = await call(url, 'POST', '/api/v1/auth/control-link', { email: 'superadmin@invexa.local', password: 'not-it' }, admin);
    }
    assert.equal(last.status, 429, 'brute force is cut off');
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link', platform(), admin)).status, 429, 'even the right password waits out the lock');
    await clearFailures(`control-link:${user.id}`);
  });
});

test('only an active ADMIN can link or use a link; others and anonymous callers are refused', async () => {
  await withServer(async (url) => {
    for (const email of ['manager@retail.local', 'store@retail.local', 'picker@retail.local', 'auditor@retail.local']) {
      const token = tokenFor(email);
      assert.equal((await call(url, 'POST', '/api/v1/auth/control-link', platform(), token)).status, 403, email);
      assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, token)).status, 403, email);
      assert.equal((await call(url, 'GET', '/api/v1/auth/control-link', undefined, token)).body.linked, false, email);
    }
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link', platform())).status, 401);
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {})).status, 401);
  });
});

test('a link stops working when the app user stops being ADMIN, and after unlinking', async () => {
  await withServer(async (url) => {
    const user = findUserByEmail('admin@retail.local')!;
    const admin = tokenFor('admin@retail.local');
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link', platform(), admin)).status, 201);

    user.role = 'STORE_USER';
    try {
      assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin)).status, 403, 'a demoted user loses the panel at once');
    } finally {
      user.role = 'ADMIN';
    }
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin)).status, 201);

    const unlinked = await call(url, 'DELETE', '/api/v1/auth/control-link', undefined, admin);
    assert.equal(unlinked.body.removed, true);
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin)).status, 404);
    assert.ok(controlPlane.audit.some((event) => event.action === 'APP_LINK_REMOVED'));
  });
});

test('a suspended platform account cannot be used through a link', async () => {
  await withServer(async (url) => {
    const admin = tokenFor('admin@retail.local');
    assert.equal((await call(url, 'POST', '/api/v1/auth/control-link', platform(), admin)).status, 201);
    const account = controlPlane.platformUsers.get('platform-super-1')!;
    account.status = 'suspended';
    try {
      assert.equal((await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin)).status, 403);
      assert.equal((await call(url, 'GET', '/api/v1/auth/control-link', undefined, admin)).body.linked, false);
    } finally {
      account.status = 'active';
    }
  });
});

test('codes do not cross purposes: a web or company handoff code never opens the panel, and back', async () => {
  await withServer(async (url) => {
    const admin = tokenFor('admin@retail.local');
    const web = await call(url, 'POST', '/api/v1/auth/web-handoff', {}, admin);
    assert.equal((await call(url, 'POST', '/control/v1/auth/app-link/exchange', { code: web.body.code })).status, 401);

    await call(url, 'POST', '/api/v1/auth/control-link', platform(), admin);
    const panel = await call(url, 'POST', '/api/v1/auth/control-link/handoff', {}, admin);
    assert.equal((await call(url, 'POST', '/control/v1/sessions/handoff/exchange', { code: panel.body.code })).status, 401);
    assert.equal((await call(url, 'POST', '/api/v1/auth/web-handoff/exchange', { code: panel.body.code })).status, 401);
  });
});
