import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateJWT,
  hashPassword,
  hashPin,
  isLegacyPasswordHash,
  pinHashNeedsUpgrade,
  resolveOtpDeliveryChannel,
  sendOtpEmail,
  setOtpSmtpSender,
  verifyJWT,
  verifyPassword,
  verifyPin,
} from './otp-auth.js';

function decodePayload(token: string): { exp: number; tokenType?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number; tokenType?: string };
}

test('access tokens verify and carry userId/companyId', () => {
  const access = generateJWT('user-1', 'company-1');
  assert.deepEqual(verifyJWT(access, 'access'), { userId: 'user-1', companyId: 'company-1' });
});

test('password hashes are bcrypt and never flagged legacy', () => {
  const hash = hashPassword('Sup3rSecret!');
  assert.ok(hash.startsWith('$2'), 'hashPassword must stay bcrypt (prisma/seed.ts depends on it)');
  assert.equal(isLegacyPasswordHash(hash), false);
  assert.equal(verifyPassword('Sup3rSecret!', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('legacy sha256 password hashes verify only as a migration source', () => {
  const legacy = createHash('sha256').update('OldPass123').digest('hex');
  assert.equal(isLegacyPasswordHash(legacy), true);
  assert.equal(verifyPassword('OldPass123', legacy), true);
  assert.equal(verifyPassword('NotThePassword', legacy), false);
});

test('migrate-on-login contract: legacy verify, re-hash, upgraded hash verifies and is not legacy', () => {
  // Mirrors the /login and authenticateUser flows: the stored value starts
  // as a legacy sha256 hex; after a successful verify it is replaced with
  // hashPassword() output, which then verifies through the bcrypt branch.
  let stored = createHash('sha256').update('OldPass123').digest('hex');
  assert.equal(verifyPassword('OldPass123', stored), true);
  if (isLegacyPasswordHash(stored)) stored = hashPassword('OldPass123');
  assert.equal(isLegacyPasswordHash(stored), false);
  assert.equal(verifyPassword('OldPass123', stored), true);
  assert.equal(verifyPassword('OldPass124', stored), false);
});

test('PIN hashes are bcrypt, verify, and reject wrong PINs', () => {
  const hash = hashPin('4821');
  assert.ok(hash.startsWith('$2'), 'PINs must be bcrypt-hashed, not sha256');
  assert.equal(pinHashNeedsUpgrade(hash), false);
  assert.equal(verifyPin('4821', hash), true);
  assert.equal(verifyPin('4822', hash), false);
  assert.throws(() => hashPin('123'), /exactly 4 digits/);
  assert.equal(verifyPin('123', hash), false);
});

test('legacy sha256 PIN hashes still verify and are flagged for upgrade', () => {
  const legacy = createHash('sha256').update('4821').digest('hex');
  assert.equal(pinHashNeedsUpgrade(legacy), true);
  assert.equal(verifyPin('4821', legacy), true);
  assert.equal(verifyPin('9021', legacy), false);
  // The upgrade the verify-biometric route performs on success:
  const upgraded = hashPin('4821');
  assert.equal(pinHashNeedsUpgrade(upgraded), false);
  assert.equal(verifyPin('4821', upgraded), true);
});

test('tampered tokens are rejected', () => {
  const token = generateJWT('user-1', 'company-1');
  assert.equal(verifyJWT(`${token}x`, 'access'), null);
});

test('expired access tokens are rejected', () => {
  const expired = generateJWT('user-1', 'company-1', -10, 'access');
  assert.equal(verifyJWT(expired, 'access'), null);
});

test('access tokens are short lived', () => {
  const access = generateJWT('user-1', 'company-1');
  const accessExp = decodePayload(access).exp;
  assert.ok(accessExp - Math.floor(Date.now() / 1000) <= ACCESS_TOKEN_TTL_SECONDS);
  assert.ok(ACCESS_TOKEN_TTL_SECONDS <= 15 * 60, 'ADR-003: access tokens must be short lived');
});

function withOtpEnv(overrides: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};
  const keys = ['NODE_ENV', 'ENABLE_DEV_OTP', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PASS', 'EMAIL_FROM'];
  for (const key of keys) previous[key] = process.env[key];
  try {
    for (const key of keys) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    return run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    setOtpSmtpSender(null);
  }
}

test('OTP delivery fails closed when a provider is not configured', async () => {
  await withOtpEnv({ NODE_ENV: 'production' }, async () => {
    assert.equal(resolveOtpDeliveryChannel(), 'none');
    assert.equal(await sendOtpEmail('admin@example.com', '123456'), false);
  });
});

test('OTP delivery stays fail-closed in production even when ENABLE_DEV_OTP is set', async () => {
  await withOtpEnv({ NODE_ENV: 'production', ENABLE_DEV_OTP: 'true' }, async () => {
    assert.equal(resolveOtpDeliveryChannel(), 'none');
    assert.equal(await sendOtpEmail('admin@example.com', '123456'), false);
  });
});

test('OTP uses the development console transport when ENABLE_DEV_OTP is set', async () => {
  await withOtpEnv({ NODE_ENV: 'development', ENABLE_DEV_OTP: 'true' }, async () => {
    assert.equal(resolveOtpDeliveryChannel(), 'development');
    assert.equal(await sendOtpEmail('admin@retail.local', '654321'), true);
  });
});

test('OTP prefers SMTP when SMTP_HOST is configured', async () => {
  await withOtpEnv({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com', ENABLE_DEV_OTP: 'true' }, async () => {
    const sent: Array<[string, string]> = [];
    setOtpSmtpSender(async (email, otpCode) => {
      sent.push([email, otpCode]);
    });
    assert.equal(resolveOtpDeliveryChannel(), 'smtp');
    assert.equal(await sendOtpEmail('admin@retail.local', '111222'), true);
    assert.deepEqual(sent, [['admin@retail.local', '111222']]);
  });
});

test('SMTP delivery failures do not leak an undelivered code', async () => {
  await withOtpEnv({ SMTP_HOST: 'smtp.example.com' }, async () => {
    setOtpSmtpSender(async () => {
      throw new Error('smtp down');
    });
    assert.equal(await sendOtpEmail('admin@retail.local', '111222'), false);
  });
});

test('production token generation requires an explicit JWT secret', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSecret = process.env.JWT_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  try {
    assert.throws(() => generateJWT('user-1', 'company-1'), /JWT_SECRET/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
