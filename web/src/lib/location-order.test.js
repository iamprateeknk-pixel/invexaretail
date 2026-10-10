import assert from 'node:assert/strict';
import test from 'node:test';
import { moveLocationId } from './location-order.js';

test('a location moves one place up or down and nothing else changes', () => {
  const ids = ['gopalpura', 'jaljog', 'ho-basni', 'ratanada'];
  assert.deepEqual(moveLocationId(ids, 'ho-basni', -1), ['gopalpura', 'ho-basni', 'jaljog', 'ratanada']);
  assert.deepEqual(moveLocationId(ids, 'ho-basni', 1), ['gopalpura', 'jaljog', 'ratanada', 'ho-basni']);
  assert.deepEqual(ids, ['gopalpura', 'jaljog', 'ho-basni', 'ratanada'], 'the input list is not mutated');
});

test('moving past either end or an unknown id is a no-op (null)', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(moveLocationId(ids, 'a', -1), null);
  assert.equal(moveLocationId(ids, 'c', 1), null);
  assert.equal(moveLocationId(ids, 'zzz', 1), null);
});
