import assert from 'node:assert/strict';
import test from 'node:test';
import { HANDOFF_TTL_MS, createHandoff, pendingHandoffCount, redeemHandoff, resetHandoffsForTest } from './session-handoff.js';

test.beforeEach(() => resetHandoffsForTest());

test('a code redeems the session exactly once', async () => {
  const { code } = await createHandoff({ controlToken: 't1' });
  assert.deepEqual(await redeemHandoff(code), { controlToken: 't1' });
  assert.equal(await redeemHandoff(code), null, 'a second redeem gets nothing');
  assert.equal(pendingHandoffCount(), 0);
});

test('a code expires after the TTL and is then unusable', async () => {
  const now = 1_000_000;
  const { code } = await createHandoff({ a: 1 }, now);
  assert.equal(await redeemHandoff(code, now + HANDOFF_TTL_MS + 1), null);
  assert.equal(pendingHandoffCount(), 0, 'an expired code is removed on redeem');
});

test('unknown, malformed and guessed codes all look the same (null)', async () => {
  await createHandoff({ a: 1 });
  for (const guess of ['', 'short', 'x'.repeat(43), 'x'.repeat(500), undefined as unknown as string, 42 as unknown as string]) {
    assert.equal(await redeemHandoff(guess), null);
  }
  assert.equal(pendingHandoffCount(), 1, 'failed guesses do not consume anyone else\'s code');
});

test('successive handoffs produce distinct codes', async () => {
  const issued = await Promise.all(Array.from({ length: 50 }, () => createHandoff({})));
  const codes = new Set(issued.map(({ code }) => code));
  assert.equal(codes.size, 50);
  for (const code of codes) assert.ok(code.length >= 43);
});

test('a flood is bounded: the oldest pending code is dropped, newer ones still work', async () => {
  const first = await createHandoff({ n: 0 });
  for (let i = 1; i <= 500; i += 1) await createHandoff({ n: i });
  assert.equal(pendingHandoffCount(), 500);
  assert.equal(await redeemHandoff(first.code), null, 'the oldest was evicted');
  const fresh = await createHandoff({ n: 'fresh' });
  assert.deepEqual(await redeemHandoff(fresh.code), { n: 'fresh' });
});
