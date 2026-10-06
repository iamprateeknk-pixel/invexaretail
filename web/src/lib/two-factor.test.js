import test from 'node:test';
import assert from 'node:assert/strict';
import { isTwoFactorChallenge, normalizeTwoFactorCode, twoFactorCodeLooksValid } from './two-factor.js';

test('a challenge needs the flag and a token; a normal session is not one', () => {
  assert.equal(isTwoFactorChallenge({ twoFactorRequired: true, challengeToken: 't' }), true);
  assert.equal(isTwoFactorChallenge({ twoFactorRequired: true }), false);
  assert.equal(isTwoFactorChallenge({ token: 'a', user: {} }), false);
  assert.equal(isTwoFactorChallenge(null), false);
});

test('codes are trimmed and uppercased', () => {
  assert.equal(normalizeTwoFactorCode(' 123 456 '), '123456');
  assert.equal(normalizeTwoFactorCode('abcde-23456'), 'ABCDE-23456');
  assert.equal(normalizeTwoFactorCode(undefined), '');
});

test('accepts 6-digit authenticator codes and backup codes only', () => {
  assert.equal(twoFactorCodeLooksValid('123456'), true);
  assert.equal(twoFactorCodeLooksValid('ABCDE-23456'), true);
  assert.equal(twoFactorCodeLooksValid('ABCDE23456'), true);
  assert.equal(twoFactorCodeLooksValid('12345'), false);
  assert.equal(twoFactorCodeLooksValid('ABCDE-2345'), false);
  assert.equal(twoFactorCodeLooksValid(''), false);
});
