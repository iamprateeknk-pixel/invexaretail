import test from 'node:test';
import assert from 'node:assert/strict';
import { beginEnrollment, confirmEnrollment, disableTwoFactor, isTwoFactorEnabled, resetTwoFactorForTests, twoFactorStatus, verifySecondFactor } from './two-factor-store.js';
import { totpCodeForStep, totpStepFor } from './totp.js';

test.beforeEach(() => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  resetTwoFactorForTests();
});

async function enrol(userId: string) {
  const begun = await beginEnrollment(userId);
  assert.ok('secret' in begun);
  const step = totpStepFor(Date.now());
  const confirmed = await confirmEnrollment(userId, totpCodeForStep(begun.secret, step));
  assert.ok(confirmed);
  return { secret: begun.secret, step, backupCodes: confirmed.backupCodes };
}

test('enrolment is pending until a valid code confirms it, then yields 8 backup codes once', async () => {
  const begun = await beginEnrollment('u1');
  assert.ok('secret' in begun);
  assert.deepEqual(await twoFactorStatus('u1'), { enabled: false, pendingSetup: true, backupCodesRemaining: 0 });
  assert.equal(await confirmEnrollment('u1', '000000'), null, 'a wrong code does not enable it');
  assert.equal(await isTwoFactorEnabled('u1'), false);
  const confirmed = await confirmEnrollment('u1', totpCodeForStep(begun.secret, totpStepFor(Date.now())));
  assert.equal(confirmed?.backupCodes.length, 8);
  assert.deepEqual(await twoFactorStatus('u1'), { enabled: true, pendingSetup: false, backupCodesRemaining: 8 });
  assert.deepEqual(await beginEnrollment('u1'), { alreadyEnabled: true });
});

test('a TOTP code works once; the same step cannot be replayed', async () => {
  const { secret, step } = await enrol('u2');
  // the enrolment code consumed `step`, so the next valid code is a later step within the window
  assert.equal(await verifySecondFactor('u2', totpCodeForStep(secret, step)), null, 'enrolment code cannot be replayed at sign-in');
  const next = totpCodeForStep(secret, step + 1);
  assert.equal(await verifySecondFactor('u2', next), 'totp');
  assert.equal(await verifySecondFactor('u2', next), null);
});

test('a backup code works exactly once', async () => {
  const { backupCodes } = await enrol('u3');
  assert.equal(await verifySecondFactor('u3', backupCodes[0]), 'backup');
  assert.equal(await verifySecondFactor('u3', backupCodes[0]), null);
  assert.equal(await verifySecondFactor('u3', backupCodes[1].toLowerCase().replace('-', ' ')), 'backup', 'case and separator are forgiven');
  assert.equal((await twoFactorStatus('u3')).backupCodesRemaining, 6);
});

test('a user without two-factor never passes verification, and disable removes it', async () => {
  assert.equal(await verifySecondFactor('nobody', '123456'), null);
  await enrol('u4');
  await disableTwoFactor('u4');
  assert.equal(await isTwoFactorEnabled('u4'), false);
});

test('secrets are not stored in the clear', async () => {
  const { secret } = await enrol('u5');
  const status = JSON.stringify(await twoFactorStatus('u5'));
  assert.ok(!status.includes(secret));
});
