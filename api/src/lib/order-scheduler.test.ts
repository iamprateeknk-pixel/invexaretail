import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSweepTick } from './order-scheduler.js';

test('a sweep expires first, then retries backorders, and announces only when something changed', async () => {
  const calls: string[] = [];
  const deps = (expired: number, filled: number) => ({
    expire: async () => { calls.push('expire'); return expired; },
    retry: async () => { calls.push('retry'); return filled; },
    announce: () => { calls.push('announce'); },
  });
  assert.deepEqual(await orderSweepTick(deps(2, 1)), { expired: 2, filled: 1 });
  assert.deepEqual(calls, ['expire', 'retry', 'announce']);
  calls.length = 0;
  await orderSweepTick(deps(0, 0));
  assert.deepEqual(calls, ['expire', 'retry']);
});

test('a failing sweep is swallowed, and overlapping sweeps are not stacked', async () => {
  const failing = { expire: async () => { throw new Error('db down'); }, retry: async () => 0, announce: () => undefined };
  assert.equal(await orderSweepTick(failing), null);

  let release: () => void = () => undefined;
  const slow = { expire: () => new Promise<number>((resolve) => { release = () => resolve(0); }), retry: async () => 0, announce: () => undefined };
  const first = orderSweepTick(slow);
  assert.equal(await orderSweepTick(slow), null, 'the second pass is skipped while the first runs');
  release();
  assert.deepEqual(await first, { expired: 0, filled: 0 });
});
