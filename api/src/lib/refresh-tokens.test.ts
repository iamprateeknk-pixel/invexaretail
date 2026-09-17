import assert from 'node:assert/strict';
import test from 'node:test';
import { generateRefreshToken } from './otp-auth.js';
import {
  isRefreshTokenRevoked,
  revokeRefreshToken,
  storeRefreshToken,
  validateRefreshToken,
} from './enterprise-repository.js';

test('logout revokes a refresh token so it cannot be reused', () => {
  const token = generateRefreshToken('user-1', 'company-1');
  storeRefreshToken(token, 'user-1', 'company-1');
  assert.ok(validateRefreshToken(token));

  revokeRefreshToken(token);
  assert.equal(isRefreshTokenRevoked(token), true);
  assert.equal(validateRefreshToken(token), null);
});
