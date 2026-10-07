import test from 'node:test';
import assert from 'node:assert/strict';

import { REQUIRED_WEB_ORIGINS, isAllowedOrigin, normalizeOrigin, resolveAllowedOrigins } from './cors-origins.js';

test('keeps the live website even when ALLOWED_ORIGINS is empty or API-only', () => {
  assert.deepEqual(resolveAllowedOrigins(''), REQUIRED_WEB_ORIGINS);
  const origins = resolveAllowedOrigins('https://api.invexaretail.com');
  assert.ok(origins.includes('https://invexaretail.com'));
  assert.ok(origins.includes('https://www.invexaretail.com'));
  assert.ok(origins.includes('https://invexaretail-web.iamprateek-nk.workers.dev'));
  assert.ok(origins.includes('https://invexaretail.prateek160298.workers.dev'));
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
