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

const staging = {
  INVEXA_ENV: 'staging',
  PUBLIC_API_URL: 'https://api.staging.example.test',
  PUBLIC_WEB_URL: 'https://app.staging.example.test',
  PUBLIC_CONTROL_URL: 'https://control.staging.example.test',
};

test('staging permits only its configured HTTPS browser origins and supports native requests', () => {
  const origins = resolveAllowedOrigins(' https://APP.staging.example.test/, https://control.staging.example.test ', staging);
  assert.deepEqual(origins, [staging.PUBLIC_WEB_URL, staging.PUBLIC_CONTROL_URL]);
  for (const origin of REQUIRED_WEB_ORIGINS) assert.equal(isAllowedOrigin(origin, origins), false, origin);
  assert.equal(isAllowedOrigin(undefined, origins), true);
});

test('staging rejects missing, mixed, and non-origin deployment values', () => {
  const valid = `${staging.PUBLIC_WEB_URL},${staging.PUBLIC_CONTROL_URL}`;
  assert.throws(() => resolveAllowedOrigins(undefined, staging), /ALLOWED_ORIGINS/);
  assert.throws(() => resolveAllowedOrigins(staging.PUBLIC_WEB_URL, staging), /PUBLIC_CONTROL_URL/);
  for (const origin of ['https://invexaretail.com.:443', 'https://api.invexaretail.com', 'https://127.0.0.1',
    'http://preview.example.test', 'https://preview.example.test/path/..', 'https://user@preview.example.test']) {
    assert.throws(() => resolveAllowedOrigins(`${valid},${origin}`, staging), /ALLOWED_ORIGINS/);
  }
  assert.throws(() => resolveAllowedOrigins(valid, { ...staging, PUBLIC_API_URL: 'https://invexaretail.com' }), /PUBLIC_API_URL/);
  assert.throws(() => resolveAllowedOrigins(valid, { ...staging, INVEXA_ENV: 'stagin' }), /INVEXA_ENV/);
});
