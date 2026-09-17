import test from 'node:test';
import assert from 'node:assert/strict';
import { sequenceKeyForBin } from './pick-wave.js';

test('sequenceKeyForBin builds a walking-order key from the bin hierarchy', () => {
  assert.equal(sequenceKeyForBin({ code: 'B12', zone: 'A', aisle: '01', rack: '03', shelf: '2' }), 'A-01-03-2-B12');
  assert.equal(sequenceKeyForBin({ code: 'B12', zone: null, aisle: null, rack: null, shelf: null }), 'B12');
});

test('sequenceKeyForBin sorts bin-less items after every known bin', () => {
  const keys = [sequenceKeyForBin({ code: 'A01', zone: 'A' }), sequenceKeyForBin(null), sequenceKeyForBin({ code: 'B01', zone: 'B' })].sort();
  assert.equal(keys[keys.length - 1], '~unassigned');
});
