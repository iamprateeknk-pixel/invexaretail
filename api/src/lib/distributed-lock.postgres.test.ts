// Session advisory locks on real Postgres: the lock is pinned to one
// dedicated connection for the whole critical section, so a second caller is
// refused while the first holds it, and the lock is free again afterwards.
// Skipped unless TEST_DATABASE_URL is set.
import assert from 'node:assert/strict';
import test from 'node:test';
import { withDistributedLock } from './distributed-lock.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('a second caller is refused while the lock is held, and the lock frees after', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  const first = withDistributedLock('test-lock-contention', async () => {
    entered = true;
    await gate;
    return 'first';
  });
  for (let i = 0; i < 100 && !entered; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(entered, true);
  const second = await withDistributedLock('test-lock-contention', async () => 'second');
  assert.equal(second, null);
  release();
  assert.equal(await first, 'first');
  const third = await withDistributedLock('test-lock-contention', async () => 'third');
  assert.equal(third, 'third');
});

integration('different lock names do not block each other', async () => {
  const both = await withDistributedLock('test-lock-a', async () => withDistributedLock('test-lock-b', async () => 'both'));
  assert.equal(both, 'both');
});
