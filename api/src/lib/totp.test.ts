import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode, base32Encode, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, otpauthUri,
  totpCodeForStep, totpIsConfigured, totpStepFor, verifyTotp,
} from './totp.js';

// RFC 6238 appendix B: SHA1 secret is ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('matches the RFC 6238 SHA1 test vectors (6 digits)', () => {
  const vectors: Array<[number, string]> = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];
  for (const [seconds, expected] of vectors) {
    assert.equal(totpCodeForStep(RFC_SECRET, totpStepFor(seconds * 1000)), expected, `t=${seconds}`);
  }
});

test('base32 round-trips', () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.throws(() => base32Decode('not*base32'));
});

test('verifyTotp accepts the current and adjacent steps, rejects others and malformed codes', () => {
  const now = 1_700_000_000_000;
  const step = totpStepFor(now);
  assert.equal(verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step), { timeMs: now }), step);
  assert.equal(verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 1), { timeMs: now }), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + 5), { timeMs: now }), null);
  assert.equal(verifyTotp(RFC_SECRET, '12345', { timeMs: now }), null);
  assert.equal(verifyTotp(RFC_SECRET, 'abcdef', { timeMs: now }), null);
});

test('a code cannot be replayed: steps at or below afterStep are rejected', () => {
  const now = 1_700_000_000_000;
  const step = totpStepFor(now);
  const code = totpCodeForStep(RFC_SECRET, step);
  assert.equal(verifyTotp(RFC_SECRET, code, { timeMs: now, afterStep: step }), null);
  assert.equal(verifyTotp(RFC_SECRET, code, { timeMs: now, afterStep: step - 1 }), step);
});

test('generated secrets are 160-bit base32 and unique', () => {
  const a = generateTotpSecret();
  assert.equal(base32Decode(a).length, 20);
  assert.notEqual(a, generateTotpSecret());
});

test('otpauth URI carries the secret, issuer and parameters', () => {
  const uri = otpauthUri('a@b.com', 'ABC234');
  assert.match(uri, /^otpauth:\/\/totp\/Invexa%20Retail%3Aa%40b\.com\?secret=ABC234&issuer=Invexa%20Retail&algorithm=SHA1&digits=6&period=30$/);
});

test('secrets at rest: encrypt/decrypt round-trips with a random IV and tamper is detected', () => {
  const previous = process.env.TOTP_ENCRYPTION_KEY;
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    assert.equal(totpIsConfigured(), true);
    const secret = generateTotpSecret();
    const a = encryptTotpSecret(secret);
    const b = encryptTotpSecret(secret);
    assert.notEqual(a, b, 'each encryption uses a fresh IV');
    assert.equal(decryptTotpSecret(a), secret);
    const [iv, tag, ct] = a.split('.');
    assert.throws(() => decryptTotpSecret([iv, tag, `${ct.slice(0, -2)}AA`].join('.')));
  } finally {
    if (previous === undefined) delete process.env.TOTP_ENCRYPTION_KEY; else process.env.TOTP_ENCRYPTION_KEY = previous;
  }
});

test('without a valid key the feature reports not configured', () => {
  const previous = process.env.TOTP_ENCRYPTION_KEY;
  delete process.env.TOTP_ENCRYPTION_KEY;
  try {
    assert.equal(totpIsConfigured(), false);
    assert.throws(() => encryptTotpSecret('X'), /not configured/);
    process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    assert.equal(totpIsConfigured(), false, 'a short key is rejected');
  } finally {
    if (previous === undefined) delete process.env.TOTP_ENCRYPTION_KEY; else process.env.TOTP_ENCRYPTION_KEY = previous;
  }
});
