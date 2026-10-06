import test from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE_WINDOW_MS, LOCK_MS, MAX_FAILURES, clearFailures, lockState, registerFailure, resetLockoutsForTests } from './login-lockout.js';

test.beforeEach(() => resetLockoutsForTests());

test('an account locks on the MAX_FAILURES-th failure and reports when to retry', async () => {
  const now = 1_000_000;
  for (let i = 1; i < MAX_FAILURES; i += 1) {
    assert.deepEqual(await registerFailure('a@x.com', now), { locked: false });
  }
  const locked = await registerFailure('a@x.com', now);
  assert.deepEqual(locked, { locked: true, retryAfterSeconds: LOCK_MS / 1000 });
  assert.equal((await lockState('a@x.com', now + 1000)).locked, true);
});

test('the lock expires and a different account is unaffected', async () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_FAILURES; i += 1) await registerFailure('a@x.com', now);
  assert.equal((await lockState('a@x.com', now + LOCK_MS + 1)).locked, false);
  assert.equal((await lockState('b@x.com', now)).locked, false);
});

test('failures outside the window do not accumulate', async () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_FAILURES - 1; i += 1) await registerFailure('a@x.com', now);
  assert.equal((await registerFailure('a@x.com', now + FAILURE_WINDOW_MS + 1)).locked, false, 'a stale streak starts over');
});

test('a successful sign-in clears the streak, and keys are case-insensitive', async () => {
  const now = 1_000_000;
  for (let i = 0; i < MAX_FAILURES - 1; i += 1) await registerFailure('A@x.com', now);
  await clearFailures('a@X.com');
  assert.equal((await registerFailure('a@x.com', now)).locked, false);
});
