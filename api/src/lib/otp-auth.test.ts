import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOtpSession,
  verifyOtpSession,
  clearOtpSession,
} from './enterprise-repository.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  generateJWT,
  generateRefreshToken,
  resolveOtpDeliveryChannel,
  sendOtpEmail,
  setOtpSmtpSender,
  verifyJWT,
} from './otp-auth.js';

function decodePayload(token: string): { exp: number; tokenType?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp: number; tokenType?: string };
}

test('access tokens cannot be used as refresh tokens', () => {
  const access = generateJWT('user-1', 'company-1');
  assert.deepEqual(verifyJWT(access, 'access'), { userId: 'user-1', companyId: 'company-1' });
  assert.equal(verifyJWT(access, 'refresh'), null);
});

test('refresh tokens cannot be used as access tokens', () => {
  const refresh = generateRefreshToken('user-1', 'company-1');
  assert.deepEqual(verifyJWT(refresh, 'refresh'), { userId: 'user-1', companyId: 'company-1' });
  assert.equal(verifyJWT(refresh, 'access'), null);
});

test('tampered tokens are rejected', () => {
  const token = generateJWT('user-1', 'company-1');
  assert.equal(verifyJWT(`${token}x`, 'access'), null);
});

test('refresh tokens issued in the same second are unique so logout can revoke one of them', () => {
  const first = generateRefreshToken('user-1', 'company-1');
  const second = generateRefreshToken('user-1', 'company-1');
  assert.notEqual(first, second);
});

test('expired access tokens are rejected while refresh tokens outlive a workday', () => {
  const expired = generateJWT('user-1', 'company-1', -10, 'access');
  assert.equal(verifyJWT(expired, 'access'), null);

  const access = generateJWT('user-1', 'company-1');
  const refresh = generateRefreshToken('user-1', 'company-1');
  const accessExp = decodePayload(access).exp;
  const refreshExp = decodePayload(refresh).exp;
  assert.ok(accessExp - Math.floor(Date.now() / 1000) <= ACCESS_TOKEN_TTL_SECONDS);
  assert.ok(refreshExp - accessExp >= REFRESH_TOKEN_TTL_SECONDS - ACCESS_TOKEN_TTL_SECONDS - 5);
  assert.equal(decodePayload(refresh).tokenType, 'refresh');
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


test('a new OTP replaces the previous unused code for the same email', () => {
  createOtpSession('Admin@retail.local', '111111');
  createOtpSession('admin@retail.local', '222222');
  assert.equal(verifyOtpSession('admin@retail.local', '111111'), false);
  assert.equal(verifyOtpSession('admin@retail.local', '222222'), true);
  clearOtpSession('admin@retail.local');
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
