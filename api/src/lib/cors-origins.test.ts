import test from 'node:test';
import assert from 'node:assert/strict';

import { REQUIRED_WEB_ORIGINS, isAllowedOrigin, normalizeOrigin, resolveAllowedOrigins } from './cors-origins.js';

test('the always-allowed origins are exactly the self-hosted production hosts plus local dev', () => {
  // Exact list, not substring checks: the retired Cloudflare Workers hosts must not be trusted,
  // and the Control Plane at admin.invexaretail.com must be.
  assert.deepEqual(REQUIRED_WEB_ORIGINS, [
    'https://invexaretail.com',
    'https://www.invexaretail.com',
    'https://control.invexaretail.com',
    'https://admin.invexaretail.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
});

test('keeps the live website even when ALLOWED_ORIGINS is empty or API-only', () => {
  assert.deepEqual(resolveAllowedOrigins(''), REQUIRED_WEB_ORIGINS);
  const allowed = new Set(resolveAllowedOrigins('https://api.invexaretail.com'));
  for (const origin of [...REQUIRED_WEB_ORIGINS, 'https://api.invexaretail.com']) {
    assert.equal(allowed.has(origin), true, origin);
  }
  assert.equal(allowed.size, REQUIRED_WEB_ORIGINS.length + 1);
});

test('normalizes Hostinger env values and browser origins', () => {
  const origins = resolveAllowedOrigins(' https://INVEXARETAIL.com/ , https://admin.example.com/path/ ');
  assert.equal(normalizeOrigin(' https://INVEXARETAIL.com/ '), 'https://invexaretail.com');
  assert.ok(origins.includes('https://admin.example.com'));
  assert.equal(isAllowedOrigin('https://invexaretail.com/', origins), true);
  assert.equal(isAllowedOrigin('https://evil.example', origins), false);
  assert.equal(isAllowedOrigin(undefined, origins), true);
});
