import test from 'node:test';
import assert from 'node:assert/strict';
import { setPendingItem, takePendingItem } from './pending-item.js';

test('pending item is a no-op without sessionStorage', () => {
  setPendingItem({ id: 'a' });
  assert.equal(takePendingItem(), null);
});

test('pending item round-trips once', () => {
  const data = new Map();
  globalThis.sessionStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  try {
    setPendingItem({ id: 'it-1', name: 'Rice', code: 'R1' });
    assert.equal(takePendingItem().id, 'it-1');
    assert.equal(takePendingItem(), null);
  } finally {
    delete globalThis.sessionStorage;
  }
});
