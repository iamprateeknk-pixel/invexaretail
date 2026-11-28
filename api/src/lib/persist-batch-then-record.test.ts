import assert from 'node:assert/strict';
import test from 'node:test';
import { persistBatchThenRecord } from './persist-batch-then-record.js';

test('a failed durable batch writes none of its records to the memory mirror', async () => {
  const recorded: number[] = [];
  await assert.rejects(
    persistBatchThenRecord([1, 2, 3], async () => { throw new Error('database transaction failed'); }, (record) => recorded.push(record)),
    /database transaction failed/,
  );
  assert.deepEqual(recorded, []);
});

test('a successful durable batch updates the memory mirror only after persistence succeeds', async () => {
  const order: string[] = [];
  await persistBatchThenRecord([1, 2], async (records) => {
    assert.deepEqual(records, [1, 2]);
    order.push('persist');
  }, (record) => order.push(`record:${record}`));
  assert.deepEqual(order, ['persist', 'record:1', 'record:2']);
});
