// Phase 5: optional TOTP two-factor sign-in and per-account lockout, end to
// end over HTTP in memory mode (database-mode persistence of the same stores
// is covered by lib/two-factor-store.postgres.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { hashPassword } from '../lib/otp-auth.js';
import { createEnhancedUser, findUserByEmail, seedEnhancedUsersForMemoryMode } from '../lib/enterprise-repository.js';
import { seedUsers } from '../lib/seed.js';
import enterpriseAuthRouter from './enterprise-auth.js';
import { MAX_FAILURES, resetLockoutsForTests } from '../lib/login-lockout.js';
import { resetTwoFactorForTests } from '../lib/two-factor-store.js';
import { totpCodeForStep, totpStepFor } from '../lib/totp.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'ChangeMe123!';

type Reply = { status: number; body: any; headers: Headers };
type Call = (method: string, path: string, body?: unknown, token?: string) => Promise<Reply>;

async function withServer(run: (call: Call) => Promise<void>): Promise<void> {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  resetLockoutsForTests();
  resetTwoFactorForTests();
  seedEnhancedUsersForMemoryMode(seedUsers, hashPassword(PASSWORD));
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', enterpriseAuthRouter);
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  const base = `http://127.0.0.1:${address.port}/api/v1/auth`;
  const call: Call = async (method, path, body, token) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})), headers: response.headers };
  };
  try {
    await run(call);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeUser(tag: string, status: 'active' | 'inactive' = 'active') {
  const email = `${tag}-${Math.random().toString(36).slice(2, 8)}@retail.local`;
  createEnhancedUser({
    id: `user-${email}`, companyId: findUserByEmail('admin@retail.local')!.companyId, email, name: tag,
    role: 'ADMIN', branchIds: [], locationIds: [], passwordHash: hashPassword(PASSWORD), status,
  });
  return email;
}

async function signIn(call: Call, email: string) {
  return call('POST', '/login', { email, password: PASSWORD });
}

async function enrol(call: Call, email: string) {
  const login = await signIn(call, email);
  const token: string = login.body.token;
  const setup = await call('POST', '/2fa/setup', {}, token);
  assert.equal(setup.status, 200);
  const secret: string = setup.body.secret;
  const enable = await call('POST', '/2fa/enable', { code: totpCodeForStep(secret, totpStepFor(Date.now())) }, token);
  assert.equal(enable.status, 200);
  return { token, secret, backupCodes: enable.body.backupCodes as string[] };
}

test('without two-factor, sign-in is unchanged', async () => {
  await withServer(async (call) => {
    const reply = await signIn(call, makeUser('plain'));
    assert.equal(reply.status, 200);
    assert.ok(reply.body.token);
    assert.equal(reply.body.twoFactorRequired, undefined);
  });
});

test('enrolment returns an otpauth URI and one-time backup codes; status reflects it', async () => {
  await withServer(async (call) => {
    const email = makeUser('enrol');
    const token = (await signIn(call, email)).body.token;
    assert.deepEqual((await call('GET', '/2fa/status', undefined, token)).body, { configured: true, enabled: false, pendingSetup: false, backupCodesRemaining: 0 });
    const setup = await call('POST', '/2fa/setup', {}, token);
    assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\//);
    assert.equal((await call('POST', '/2fa/enable', { code: '000000' }, token)).status, 400, 'a wrong code does not enable it');
    const enable = await call('POST', '/2fa/enable', { code: totpCodeForStep(setup.body.secret, totpStepFor(Date.now())) }, token);
    assert.equal(enable.body.backupCodes.length, 8);
    assert.equal((await call('GET', '/2fa/status', undefined, token)).body.enabled, true);
    assert.equal((await call('POST', '/2fa/setup', {}, token)).status, 409, 'cannot re-enrol while on');
  });
});

test('once on, password sign-in returns a challenge, not a session; the challenge is not an access token', async () => {
  await withServer(async (call) => {
    const email = makeUser('gate');
    await enrol(call, email);
    const reply = await signIn(call, email);
    assert.equal(reply.status, 200);
    assert.equal(reply.body.twoFactorRequired, true);
    assert.equal(reply.body.token, undefined, 'no access token before the second factor');
    assert.ok(reply.body.challengeToken);
    const misuse = await call('GET', '/2fa/status', undefined, reply.body.challengeToken);
    assert.equal(misuse.status, 401, 'a challenge token must never authenticate API calls');
  });
});

test('a valid authenticator code completes sign-in, and the same code cannot be replayed', async () => {
  await withServer(async (call) => {
    const email = makeUser('totp');
    const { secret } = await enrol(call, email);
    const challenge = (await signIn(call, email)).body.challengeToken;
    // enrolment consumed the current step, so use the next one (within the +1 window)
    const code = totpCodeForStep(secret, totpStepFor(Date.now()) + 1);
    const done = await call('POST', '/2fa/verify-login', { challengeToken: challenge, code });
    assert.equal(done.status, 200);
    assert.ok(done.body.token);
    assert.equal(done.body.user.email, email);
    const replay = await call('POST', '/2fa/verify-login', { challengeToken: (await signIn(call, email)).body.challengeToken, code });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'TWO_FACTOR_INVALID');
  });
});

test('a backup code signs in once and is then spent', async () => {
  await withServer(async (call) => {
    const email = makeUser('backup');
    const { backupCodes } = await enrol(call, email);
    const first = await call('POST', '/2fa/verify-login', { challengeToken: (await signIn(call, email)).body.challengeToken, code: backupCodes[0] });
    assert.equal(first.status, 200);
    const again = await call('POST', '/2fa/verify-login', { challengeToken: (await signIn(call, email)).body.challengeToken, code: backupCodes[0] });
    assert.equal(again.status, 401);
  });
});

test('too many wrong second-factor codes lock the account with a Retry-After', async () => {
  await withServer(async (call) => {
    const email = makeUser('tflock');
    await enrol(call, email);
    const challenge = (await signIn(call, email)).body.challengeToken;
    let last: Reply | null = null;
    for (let i = 0; i < MAX_FAILURES; i += 1) last = await call('POST', '/2fa/verify-login', { challengeToken: challenge, code: '000000' });
    assert.equal(last!.status, 429);
    assert.equal(last!.body.code, 'ACCOUNT_LOCKED');
    assert.ok(Number(last!.headers.get('retry-after')) > 0);
  });
});

test('a garbage or missing challenge is rejected', async () => {
  await withServer(async (call) => {
    assert.equal((await call('POST', '/2fa/verify-login', { challengeToken: 'nope', code: '123456' })).status, 401);
    assert.equal((await call('POST', '/2fa/verify-login', { code: '123456' })).status, 401);
  });
});

test('turning two-factor off needs a valid code; afterwards sign-in is plain again', async () => {
  await withServer(async (call) => {
    const email = makeUser('off');
    const { token, backupCodes } = await enrol(call, email);
    assert.equal((await call('POST', '/2fa/disable', { code: '000000' }, token)).status, 401);
    assert.equal((await call('POST', '/2fa/disable', { code: backupCodes[0] }, token)).status, 200);
    assert.ok((await signIn(call, email)).body.token);
  });
});

test('repeated wrong passwords lock the account even for the right password, and unknown emails behave the same', async () => {
  await withServer(async (call) => {
    const email = makeUser('pwlock');
    let last: Reply | null = null;
    for (let i = 0; i < MAX_FAILURES; i += 1) last = await call('POST', '/login', { email, password: 'wrong-password' });
    assert.equal(last!.status, 429);
    assert.equal(last!.body.code, 'ACCOUNT_LOCKED');
    const rightButLocked = await signIn(call, email);
    assert.equal(rightButLocked.status, 429, 'the correct password does not unlock early');

    let ghost: Reply | null = null;
    for (let i = 0; i < MAX_FAILURES; i += 1) ghost = await call('POST', '/login', { email: 'nobody-here@retail.local', password: 'x' });
    assert.equal(ghost!.status, 429, 'an email with no account is throttled identically, so existence is not revealed');
  });
});

test('a successful sign-in resets the failure streak', async () => {
  await withServer(async (call) => {
    const email = makeUser('reset');
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) await call('POST', '/login', { email, password: 'wrong' });
    assert.equal((await signIn(call, email)).status, 200);
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) assert.equal((await call('POST', '/login', { email, password: 'wrong' })).status, 401);
  });
});

test('an inactive account is not revealed without the password', async () => {
  await withServer(async (call) => {
    const email = makeUser('inactive', 'inactive');
    assert.equal((await call('POST', '/login', { email, password: 'wrong-password' })).status, 401, 'wrong password reads as invalid credentials, not "inactive"');
    assert.equal((await signIn(call, email)).status, 403, 'only the real password reaches the inactive message');
  });
});
