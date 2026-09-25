import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedAccessToken, verifySignedAccessToken } from './signed-access.js';

const input = { kind: 'transfer-evidence', resource: 't1/e1', companyId: 'c1' };

test('a fresh link verifies and carries exactly its resource and company', () => {
  const { token } = createSignedAccessToken(input);
  const claims = verifySignedAccessToken(token);
  assert.equal(claims?.resource, 't1/e1');
  assert.equal(claims?.companyId, 'c1');
});

test('an expired link is rejected', () => {
  const past = Date.now() - 10 * 60_000;
  const { token } = createSignedAccessToken({ ...input, ttlSeconds: 60 }, past);
  assert.equal(verifySignedAccessToken(token), null);
});

test('a tampered body or signature is rejected', () => {
  const { token } = createSignedAccessToken(input);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ kind: 'transfer-evidence', resource: 't1/OTHER', companyId: 'c1', exp: 9999999999 })).toString('base64url');
  assert.equal(verifySignedAccessToken(`${forged}.${sig}`), null);
  assert.equal(verifySignedAccessToken(`${body}.${sig.slice(0, -2)}xx`), null);
  assert.equal(verifySignedAccessToken('garbage'), null);
  assert.equal(verifySignedAccessToken(`${token}.extra`), null);
});

test('ttl is capped so a link can never be made long-lived', () => {
  const { expiresAt } = createSignedAccessToken({ ...input, ttlSeconds: 10 ** 9 });
  assert.ok(new Date(expiresAt).getTime() - Date.now() <= 3600 * 1000 + 1000);
});
