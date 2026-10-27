// DB-mode coverage for lib/session-store.ts (ADR-003). Skipped unless
// TEST_DATABASE_URL is set - see AGENTS.md "Required tests": this file must
// be run directly against a real Postgres instance, not folded into the
// default in-memory `npm test` run (session-store.test.ts covers that path).
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import {
  createOtpChallenge,
  verifyOtpChallenge,
  createRefreshFamily,
  rotateRefreshToken,
  revokeRefreshFamily,
  revokeAllSessionsForUser,
} from './session-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeUser() {
  const id = `session-test-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id,
      name: 'Session Store Test User',
      email: `${id}@test.invexa.local`,
      passwordHash: 'not-a-real-hash',
      role: 'ADMIN',
      assignedLocations: '[]',
      companyId: 'default-company',
    },
  });
  return id;
}

integration('refresh rotation is persisted in UserSession, not just in-process state', async () => {
  const userId = await makeUser();
  const issued = await createRefreshFamily(userId, 'default-company');

  const beforeRotate = await prisma.userSession.findMany({ where: { familyId: issued.familyId } });
  assert.equal(beforeRotate.length, 1);
  assert.equal(beforeRotate[0].status, 'ACTIVE');

  const rotated = await rotateRefreshToken(issued.token);
  assert.equal(rotated.ok, true);

  const afterRotate = await prisma.userSession.findMany({ where: { familyId: issued.familyId }, orderBy: { createdAt: 'asc' } });
  assert.equal(afterRotate.length, 2);
  assert.equal(afterRotate[0].status, 'ROTATED');
  assert.equal(afterRotate[1].status, 'ACTIVE');
  assert.equal(afterRotate[0].replacedByTokenHash, afterRotate[1].tokenHash);
});

integration('replaying a rotated token revokes the whole family in the database', async () => {
  const userId = await makeUser();
  const issued = await createRefreshFamily(userId, 'default-company');
  await rotateRefreshToken(issued.token);

  const replay = await rotateRefreshToken(issued.token);
  assert.deepEqual(replay, { ok: false, reason: 'reused' });

  const rows = await prisma.userSession.findMany({ where: { familyId: issued.familyId } });
  assert.ok(rows.every((row) => row.status === 'REVOKED'));
});

integration('revoke-all ends every session family for the user in the database', async () => {
  const userId = await makeUser();
  const familyA = await createRefreshFamily(userId, 'default-company');
  const familyB = await createRefreshFamily(userId, 'default-company');

  await revokeAllSessionsForUser(userId);

  const rows = await prisma.userSession.findMany({ where: { userId } });
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((row) => row.status === 'REVOKED'));
  assert.equal((await rotateRefreshToken(familyA.token)).ok, false);
  assert.equal((await rotateRefreshToken(familyB.token)).ok, false);
});

integration('logout revokes only the presented family, not the whole account, in the database', async () => {
  const userId = await makeUser();
  const familyA = await createRefreshFamily(userId, 'default-company');
  const familyB = await createRefreshFamily(userId, 'default-company');

  await revokeRefreshFamily(familyA.token);

  assert.equal((await rotateRefreshToken(familyA.token)).ok, false);
  assert.equal((await rotateRefreshToken(familyB.token)).ok, true);
});

integration('two "replicas" racing to rotate the same token: exactly one wins, per the database', async () => {
  const userId = await makeUser();
  const issued = await createRefreshFamily(userId, 'default-company');

  const [a, b] = await Promise.all([rotateRefreshToken(issued.token), rotateRefreshToken(issued.token)]);
  const outcomes = [a.ok, b.ok].sort();
  assert.deepEqual(outcomes, [false, true]);

  const rows = await prisma.userSession.findMany({ where: { familyId: issued.familyId } });
  // The race loser's reuse handling revokes the family, including the winner's freshly-issued row.
  assert.ok(rows.every((row) => row.status === 'REVOKED'));
});

integration('OTP challenges are persisted hashed, never in plaintext, and consumed atomically', async () => {
  const email = `otp-${randomUUID()}@test.invexa.local`;
  const code = await createOtpChallenge(email, 'LOGIN');

  const stored = await prisma.otpChallenge.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
  assert.ok(stored);
  assert.notEqual(stored!.codeHash, code);

  const first = await verifyOtpChallenge(email, code, 'LOGIN');
  assert.deepEqual(first, { ok: true });
  const second = await verifyOtpChallenge(email, code, 'LOGIN');
  assert.equal(second.ok, false);
});

integration('OTP brute force is locked out after max attempts, tracked in the database', async () => {
  const email = `brute-${randomUUID()}@test.invexa.local`;
  await createOtpChallenge(email, 'LOGIN');
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await verifyOtpChallenge(email, '000000', 'LOGIN');
  }
  assert.equal(last!.ok, false);
  assert.equal((last as { reason: string }).reason, 'locked');
});
