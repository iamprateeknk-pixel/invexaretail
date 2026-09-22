import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOtpChallenge,
  verifyOtpChallenge,
  clearOtpChallenge,
  createRefreshFamily,
  rotateRefreshToken,
  revokeRefreshFamily,
  revokeAllSessionsForUser,
  generateOtpCode,
  resetSessionStoreForTests,
} from './session-store.js';

test.beforeEach(() => {
  resetSessionStoreForTests();
});

test('generateOtpCode always returns a zero-padded 6-digit string', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = generateOtpCode();
    assert.match(code, /^\d{6}$/);
  }
});

test('a new OTP challenge replaces the previous unused code for the same email', async () => {
  await createOtpChallenge('Admin@retail.local', 'LOGIN');
  const second = await createOtpChallenge('admin@retail.local', 'LOGIN');
  assert.deepEqual(await verifyOtpChallenge('admin@retail.local', second, 'LOGIN'), { ok: true });
  await clearOtpChallenge('admin@retail.local', 'LOGIN');
});

test('the same OTP code cannot be consumed twice (atomic verification)', async () => {
  const code = await createOtpChallenge('once@retail.local', 'LOGIN');
  assert.deepEqual(await verifyOtpChallenge('once@retail.local', code, 'LOGIN'), { ok: true });
  const second = await verifyOtpChallenge('once@retail.local', code, 'LOGIN');
  assert.equal(second.ok, false);
});

test('OTP brute force: wrong codes lock the challenge after max attempts', async () => {
  await createOtpChallenge('brute@retail.local', 'LOGIN');
  let last;
  for (let i = 0; i < 6; i += 1) {
    last = await verifyOtpChallenge('brute@retail.local', '000000', 'LOGIN');
  }
  assert.equal(last!.ok, false);
  assert.equal((last as { reason: string }).reason, 'locked');
});

test('refresh rotation issues a new token and retires the old one', async () => {
  const issued = await createRefreshFamily('user-1', 'company-1');
  const rotated = await rotateRefreshToken(issued.token);
  assert.equal(rotated.ok, true);
  if (rotated.ok) {
    assert.notEqual(rotated.issued.token, issued.token);
    assert.equal(rotated.userId, 'user-1');
  }
});

test('replaying an already-rotated refresh token is detected as reuse and revokes the family', async () => {
  const issued = await createRefreshFamily('user-2', 'company-1');
  const rotated = await rotateRefreshToken(issued.token);
  assert.equal(rotated.ok, true);

  // Replay the original (now-rotated) token - simulates a stolen-token replay.
  const replay = await rotateRefreshToken(issued.token);
  assert.deepEqual(replay, { ok: false, reason: 'reused' });

  // The whole family, including the token issued by the legitimate rotation, is dead now.
  if (rotated.ok) {
    const afterReuse = await rotateRefreshToken(rotated.issued.token);
    assert.deepEqual(afterReuse, { ok: false, reason: 'reused' });
  }
});

test('two concurrent rotation attempts on the same token: only one wins, the race loser is treated as reuse', async () => {
  const issued = await createRefreshFamily('user-3', 'company-1');
  const [a, b] = await Promise.all([rotateRefreshToken(issued.token), rotateRefreshToken(issued.token)]);
  const outcomes = [a.ok, b.ok].sort();
  assert.deepEqual(outcomes, [false, true]);
});

test('logout revokes only the presented session family, not the whole account', async () => {
  const familyA = await createRefreshFamily('user-4', 'company-1');
  const familyB = await createRefreshFamily('user-4', 'company-1');
  await revokeRefreshFamily(familyA.token);

  const rotatedA = await rotateRefreshToken(familyA.token);
  assert.equal(rotatedA.ok, false);
  const rotatedB = await rotateRefreshToken(familyB.token);
  assert.equal(rotatedB.ok, true);
});

test('revoke-all ends every session family for the user (sign out everywhere)', async () => {
  const familyA = await createRefreshFamily('user-5', 'company-1');
  const familyB = await createRefreshFamily('user-5', 'company-1');
  await revokeAllSessionsForUser('user-5');

  assert.equal((await rotateRefreshToken(familyA.token)).ok, false);
  assert.equal((await rotateRefreshToken(familyB.token)).ok, false);
});
