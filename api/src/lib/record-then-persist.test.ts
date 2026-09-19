import test from 'node:test';
import assert from 'node:assert/strict';
import { recordThenPersist } from './record-then-persist.js';

test('a failed database write removes the in-memory record and surfaces the error', async () => {
  const memory: string[] = [];
  await assert.rejects(
    recordThenPersist(() => { memory.push('c1'); return 'c1'; }, async () => { throw new Error('db down'); }, (id) => { memory.splice(memory.indexOf(id), 1); }),
    /db down/,
  );
  assert.deepEqual(memory, [], 'no phantom record is left to answer a retry as a duplicate');
});

test('a successful write keeps the record and returns it', async () => {
  const memory: string[] = [];
  const saved: string[] = [];
  const result = await recordThenPersist(() => { memory.push('c2'); return 'c2'; }, async (id) => { saved.push(id); }, () => memory.pop());
  assert.equal(result, 'c2');
  assert.deepEqual([memory, saved], [['c2'], ['c2']]);
});
