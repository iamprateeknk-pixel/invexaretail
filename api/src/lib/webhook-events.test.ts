import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encryptWebhookSecret,
  decryptWebhookSecret,
  hashWebhookSecret,
  parseWebhookEndpoint,
  parseWebhookEvents,
  parseWebhookName,
  signWebhookBody,
  verifyWebhookSignature,
  WebhookValidationError,
} from './webhook-events.js';

test('webhook events and names reject empty payloads', () => {
  assert.throws(() => parseWebhookName('x'), WebhookValidationError);
  assert.equal(parseWebhookName('Slack ops'), 'Slack ops');
  assert.throws(() => parseWebhookEvents(['nope']), WebhookValidationError);
  assert.deepEqual(parseWebhookEvents(['count.reviewed', 'count.reviewed', 'bogus']), ['count.reviewed']);
});

test('production endpoints must be public HTTPS', () => {
  assert.equal(parseWebhookEndpoint('https://hooks.example.com/invexa').hostname, 'hooks.example.com');
  assert.throws(() => parseWebhookEndpoint('http://hooks.example.com/invexa'), /HTTPS/);
  assert.throws(() => parseWebhookEndpoint('https://127.0.0.1/hooks'), /public HTTPS/);
  assert.throws(() => parseWebhookEndpoint('https://192.168.1.9/hooks'), /public HTTPS/);
});

test('memory mode allows loopback HTTP receivers', () => {
  const local = parseWebhookEndpoint('http://127.0.0.1:4010/hooks', { allowPrivate: true });
  assert.equal(local.origin, 'http://127.0.0.1:4010');
});

test('HMAC signatures round-trip and reject tampering', () => {
  const body = '{"event":"count.reviewed"}';
  const secret = 's'.repeat(32);
  const signature = signWebhookBody(secret, body);
  assert.equal(verifyWebhookSignature(secret, body, `sha256=${signature}`), true);
  assert.equal(verifyWebhookSignature(secret, '{"event":"nope"}', `sha256=${signature}`), false);
  assert.equal(hashWebhookSecret(secret).length, 64);
});

test('webhook secrets encrypt and decrypt with JWT_SECRET', () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret';
  const sealed = encryptWebhookSecret('plain-signing-secret');
  assert.notEqual(sealed, 'plain-signing-secret');
  assert.equal(decryptWebhookSecret(sealed), 'plain-signing-secret');
  assert.equal(decryptWebhookSecret('not-valid'), null);
  if (previous === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previous;
});
