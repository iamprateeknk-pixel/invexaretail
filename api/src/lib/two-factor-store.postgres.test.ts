// DB-mode coverage for lib/two-factor-store.ts and lib/login-lockout.ts (Phase 5).
// Skipped unless TEST_DATABASE_URL is set; run it directly against a real
// Postgres (the in-memory paths are covered by *.test.ts beside it).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { beginEnrollment, confirmEnrollment, disableTwoFactor, twoFactorStatus, verifySecondFactor } from './two-factor-store.js';
import { MAX_FAILURES, clearFailures, lockState, registerFailure } from './login-lockout.js';
import { totpCodeForStep, totpStepFor } from './totp.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

process.env.TOTP_ENCRYPTION_KEY ||= Buffer.alloc(32, 3).toString('base64');

async function makeUser() {
  const id = `tf-test-${randomUUID()}`;
  await prisma.user.create({
    data: { id, name: 'Two Factor Test User', email: `${id}@test.invexa.local`, passwordHash: 'not-a-real-hash', role: 'ADMIN', assignedLocations: '[]' },
  });
  return id;
}

async function enrol(userId: string) {
  const begun = await beginEnrollment(userId);
  assert.ok('secret' in begun);
  const step = totpStepFor(Date.now());
  const confirmed = await confirmEnrollment(userId, totpCodeForStep(begun.secret, step));
  assert.ok(confirmed);
  return { secret: begun.secret, step, backupCodes: confirmed.backupCodes };
}

integration('the secret is encrypted at rest and backup codes are stored only as hashes', async () => {
  const userId = await makeUser();
  const { secret, backupCodes } = await enrol(userId);
  const row = await prisma.userTotp.findUniqueOrThrow({ where: { userId } });
  assert.ok(!row.secretEnc.includes(secret), 'the base32 secret must not appear in the stored value');
  assert.ok(row.enabledAt);
  for (const code of backupCodes) assert.ok(!row.backupCodeHashes.includes(code), 'a backup code must not be stored in the clear');
  assert.equal(JSON.parse(row.backupCodeHashes).length, 8);
  assert.deepEqual(await twoFactorStatus(userId), { enabled: true, pendingSetup: false, backupCodesRemaining: 8 });
});

integration('concurrent sign-ins with the same TOTP code: exactly one wins (no replay)', async () => {
  const userId = await makeUser();
  const { secret, step } = await enrol(userId);
  const code = totpCodeForStep(secret, step + 1);
  const results = await Promise.all(Array.from({ length: 6 }, () => verifySecondFactor(userId, code)));
  assert.equal(results.filter((r) => r === 'totp').length, 1, `results: ${JSON.stringify(results)}`);
  assert.equal((await prisma.userTotp.findUniqueOrThrow({ where: { userId } })).lastUsedStep, step + 1);
});

integration('concurrent sign-ins with the same backup code: exactly one wins', async () => {
  const userId = await makeUser();
  const { backupCodes } = await enrol(userId);
  const results = await Promise.all(Array.from({ length: 6 }, () => verifySecondFactor(userId, backupCodes[0])));
  assert.equal(results.filter((r) => r === 'backup').length, 1, `results: ${JSON.stringify(results)}`);
  assert.equal((await twoFactorStatus(userId)).backupCodesRemaining, 7);
});

integration('disable removes the row; deleting the user cascades it away', async () => {
  const a = await makeUser();
  await enrol(a);
  await disableTwoFactor(a);
  assert.equal(await prisma.userTotp.findUnique({ where: { userId: a } }), null);
  const b = await makeUser();
  await enrol(b);
  await prisma.user.delete({ where: { id: b } });
  assert.equal(await prisma.userTotp.findUnique({ where: { userId: b } }), null);
});

integration('lockout is persisted: MAX_FAILURES locks, clearing resets, keys are independent', async () => {
  const key = `lock-${randomUUID()}@test.invexa.local`;
  const other = `lock-${randomUUID()}@test.invexa.local`;
  const now = Date.now();
  for (let i = 1; i < MAX_FAILURES; i += 1) assert.equal((await registerFailure(key, now)).locked, false);
  const locked = await registerFailure(key, now);
  assert.equal(locked.locked, true);
  assert.equal((await lockState(key.toUpperCase(), now + 1000)).locked, true, 'keys are case-insensitive');
  assert.equal((await lockState(other, now)).locked, false);
  assert.ok(await prisma.authLockout.findUnique({ where: { key } }), 'the lock lives in Postgres, not process memory');
  await clearFailures(key);
  assert.equal((await lockState(key, now)).locked, false);
});
