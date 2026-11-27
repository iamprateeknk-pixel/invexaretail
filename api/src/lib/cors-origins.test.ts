import test from 'node:test';
import assert from 'node:assert/strict';

import { REQUIRED_WEB_ORIGINS, isAllowedOrigin, normalizeOrigin, resolveAllowedOrigins } from './cors-origins.js';

test('keeps the live website even when ALLOWED_ORIGINS is empty or API-only', () => {
  assert.deepEqual(resolveAllowedOrigins(''), REQUIRED_WEB_ORIGINS);
  const origins = resolveAllowedOrigins('https://api.invexaretail.com');
  assert.ok(origins.includes('https://invexaretail.com'));
  assert.ok(origins.includes('https://www.invexaretail.com'));
  assert.ok(origins.includes('https://admin.invexaretail.com'), 'the Control Plane must be able to call the API');
  assert.equal(origins.some((origin) => origin.endsWith('.workers.dev')), false, 'retired Cloudflare Workers hosts are no longer trusted');
  assert.ok(origins.includes('https://control.invexaretail.com'));
  assert.ok(origins.includes('https://api.invexaretail.com'));
});

test('normalizes Hostinger env values and browser origins', () => {
  const origins = resolveAllowedOrigins(' https://INVEXARETAIL.com/ , https://admin.example.com/path/ ');
  assert.equal(normalizeOrigin(' https://INVEXARETAIL.com/ '), 'https://invexaretail.com');
  assert.ok(origins.includes('https://admin.example.com'));
  assert.equal(isAllowedOrigin('https://invexaretail.com/', origins), true);
  assert.equal(isAllowedOrigin('https://evil.example', origins), false);
  assert.equal(isAllowedOrigin(undefined, origins), true);
});
