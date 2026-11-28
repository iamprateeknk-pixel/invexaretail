import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { promisify } from 'node:util';
import { createHandoff, HANDOFF_TTL_MS, redeemHandoff } from './session-handoff.js';
import { prisma } from '../db.js';

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const exec = promisify(execFile);

integration('a second process can redeem a handoff once after the issuer exits', async (t) => {
  const initial = process.env.CONTROL_PLANE_PERSIST_IN_TESTS;
  process.env.CONTROL_PLANE_PERSIST_IN_TESTS = '1';
  t.after(() => {
    if (initial === undefined) delete process.env.CONTROL_PLANE_PERSIST_IN_TESTS;
    else process.env.CONTROL_PLANE_PERSIST_IN_TESTS = initial;
  });
  const { stdout } = await exec(process.execPath, ['--import', 'tsx', '-e', `
    const { createHandoff } = require('./src/lib/saas/session-handoff.ts');
    Promise.resolve(createHandoff({ controlToken: 'test-session-reference' }))
      .then(({ code }) => console.log(code))
      .catch((error) => { console.error(error); process.exitCode = 1; });
  `]);
  const code = stdout.trim();
  assert.match(code, /^[a-z0-9_-]{43}$/i);
  const codeHash = createHash('sha256').update(code).digest('hex');
  const stored = await prisma.sessionHandoff.findUniqueOrThrow({ where: { codeHash } });
  assert.equal(Buffer.from(stored.payload).includes(Buffer.from('test-session-reference')), false);
  const results = await Promise.all([redeemHandoff(code), redeemHandoff(code)]);
  assert.deepEqual(results.filter(Boolean), [{ controlToken: 'test-session-reference' }]);
  assert.equal(await redeemHandoff(code), null);

  const now = Date.now();
  const expired = await createHandoff({ userId: 'expired-fixture' }, now, 'web');
  assert.equal(await redeemHandoff(expired.code, now + HANDOFF_TTL_MS, 'web'), null);
  const otherPurpose = await createHandoff({ userId: 'wrong-purpose-fixture' }, now, 'web');
  assert.equal(await redeemHandoff(otherPurpose.code, now, 'control'), null);
  assert.equal(await redeemHandoff(otherPurpose.code, now, 'web'), null);
});
