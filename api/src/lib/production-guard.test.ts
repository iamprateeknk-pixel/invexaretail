import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionSecrets, checkProductionSecrets, isKnownDefaultPassword } from './production-guard.js';

const STRONG = 'k8Vq3nZp0Lw7YtR2sXb9HcEd5MfGjA1u';

test('outside production nothing is enforced (local development keeps its fallbacks)', () => {
  assert.deepEqual(checkProductionSecrets({ NODE_ENV: 'development' }), { ok: true, errors: [], warnings: [] });
  assert.equal(checkProductionSecrets({}).ok, true);
});

test('production requires a JWT secret', () => {
  const result = checkProductionSecrets({ NODE_ENV: 'production' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /JWT_SECRET is not set/);
});

test('production rejects the placeholder secrets that are public in the source', () => {
  for (const placeholder of ['dev-secret-key-change-in-production', 'dev-secret-change-me', 'CHANGEME']) {
    const result = checkProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: placeholder });
    assert.equal(result.ok, false, placeholder);
    assert.match(result.errors[0], /placeholder/);
  }
});

test('short secrets: under 16 is an error, 16-31 is only a warning, 32+ is clean', () => {
  assert.equal(checkProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: 'tooshort' }).ok, false);
  const medium = checkProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: 'a1b2c3d4e5f6g7h8i9' });
  assert.equal(medium.ok, true);
  assert.equal(medium.warnings.length, 1);
  assert.deepEqual(checkProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: STRONG }), { ok: true, errors: [], warnings: [] });
});

test('a placeholder OTP pepper and the default seed password are rejected in production', () => {
  const result = checkProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: STRONG, OTP_PEPPER: 'dev-otp-pepper-change-in-production', SEED_PASSWORD: 'ChangeMe123!' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.equal(checkProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: STRONG, SEED_PASSWORD: 'Another-Strong-1!' }).ok, true);
});

test('assertProductionSecrets lists every problem in one error', () => {
  assert.throws(
    () => assertProductionSecrets({ NODE_ENV: 'production', OTP_PEPPER: 'secret', SEED_PASSWORD: 'ChangeMe123!' }),
    (error: Error) => /Unsafe production configuration/.test(error.message) && error.message.split('\n- ').length === 4,
  );
  assert.doesNotThrow(() => assertProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: STRONG }));
});

test('isKnownDefaultPassword', () => {
  assert.equal(isKnownDefaultPassword('ChangeMe123!'), true);
  assert.equal(isKnownDefaultPassword('Something-Else-9'), false);
});
