import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSION_STORAGE_KEY,
  accessTokenNeedsRefresh,
  clearPersistedSession,
  decodeJwtPayload,
  isAuthSessionPath,
  readPersistedSession,
  shouldClearSessionOnHydrateFailure,
  writePersistedSession,
} from './session.js';

function makeToken(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, tokenType: 'access' })).toString('base64url');
  return `header.${payload}.sig`;
}

test('auth session paths skip refresh retries', () => {
  assert.equal(isAuthSessionPath('/api/v1/auth/login'), true);
  assert.equal(isAuthSessionPath('/api/v1/auth/refresh-token'), true);
  assert.equal(isAuthSessionPath('/api/v1/auth/logout'), true);
  assert.equal(isAuthSessionPath('/api/v1/dashboard'), false);
});

test('access tokens refresh before expiry and missing exp is treated as stale', () => {
  const soon = Math.floor(Date.now() / 1000) + 10;
  const later = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(accessTokenNeedsRefresh(makeToken(soon), 60_000), true);
  assert.equal(accessTokenNeedsRefresh(makeToken(later), 60_000), false);
  assert.equal(accessTokenNeedsRefresh('not-a-jwt'), true);
  assert.equal(decodeJwtPayload(makeToken(later)).tokenType, 'access');
});

test('hydrate keeps the session unless refresh already failed with 401', () => {
  assert.equal(shouldClearSessionOnHydrateFailure({ status: 401 }, false), true);
  assert.equal(shouldClearSessionOnHydrateFailure({ status: 401 }, true), false);
  assert.equal(shouldClearSessionOnHydrateFailure({ status: 503 }, false), false);
  assert.equal(shouldClearSessionOnHydrateFailure(new Error('offline'), false), false);
});

test('browser persistence strips refresh tokens because the API owns them in an HttpOnly cookie', () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, String(value)); },
    removeItem: (key) => { mem.delete(key); },
  };

  writePersistedSession({ token: 'access', refreshToken: 'refresh', user: { id: 'u1' } });
  assert.equal(JSON.parse(mem.get(SESSION_STORAGE_KEY)).refreshToken, undefined);
  assert.equal(readPersistedSession().token, 'access');
  clearPersistedSession();
  assert.equal(readPersistedSession(), null);
});
