import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit, validateExceptions } from './audit-gate.mjs';

const report = { vulnerabilities: { lodash: { severity: 'high' }, minimist: { severity: 'critical' }, left: { severity: 'moderate' }, mysql2: { severity: 'high' } } };
const now = new Date('2026-10-07');

test('moderate findings never block; unexcepted high and critical do', () => {
  const result = evaluateAudit(report, [], 'api', now);
  assert.deepEqual(result.blocking.map((item) => item.name).sort(), ['lodash', 'minimist', 'mysql2']);
});

test('an unexpired, scoped exception clears exactly its package', () => {
  const exceptions = [{ scope: 'api', package: 'mysql2', reason: 'r', owner: 'o', expires: '2026-12-31' }];
  const result = evaluateAudit(report, exceptions, 'api', now);
  assert.deepEqual(result.excepted.map((item) => item.name), ['mysql2']);
  assert.ok(!result.blocking.some((item) => item.name === 'mysql2'));
  assert.equal(result.blocking.length, 2);
});

test('an exception scoped to another package directory does not apply', () => {
  const result = evaluateAudit(report, [{ scope: 'web', package: 'mysql2', reason: 'r', owner: 'o', expires: '2026-12-31' }], 'api', now);
  assert.ok(result.blocking.some((item) => item.name === 'mysql2'));
});

test('an expired exception fails again', () => {
  const result = evaluateAudit(report, [{ package: 'mysql2', reason: 'old', owner: 'o', expires: '2026-01-01' }], 'api', now);
  assert.deepEqual(result.expired.map((item) => item.name), ['mysql2']);
  assert.ok(!result.blocking.some((item) => item.name === 'mysql2'));
});

test('exceptions without a reason, owner or valid expiry are rejected', () => {
  assert.equal(validateExceptions([{ package: 'x', reason: 'r', owner: 'o', expires: '2027-01-01' }]).length, 0);
  assert.equal(validateExceptions([{ package: 'x' }]).length, 3);
  assert.equal(validateExceptions([{ package: 'x', reason: 'r', owner: 'o', expires: 'someday' }]).length, 1);
});

test('an empty or missing report has nothing to block', () => {
  assert.deepEqual(evaluateAudit({}, [], 'api', now), { blocking: [], excepted: [], expired: [] });
  assert.deepEqual(evaluateAudit(null, [], 'api', now), { blocking: [], excepted: [], expired: [] });
});
