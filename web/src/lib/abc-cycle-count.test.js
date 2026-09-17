import assert from 'node:assert/strict';
import test from 'node:test';
import {
  abcBadgeVariant,
  displayAbcCadence,
  displayAbcClass,
  formatCycleCountValue,
  toggleAbcClass,
} from './abc-cycle-count.js';

test('ABC labels and cadence stay operator-facing', () => {
  assert.equal(displayAbcClass('A'), 'Class A');
  assert.equal(displayAbcCadence('B'), 'Monthly');
  assert.equal(displayAbcCadence('C'), 'Quarterly');
  assert.equal(abcBadgeVariant('A'), 'destructive');
  assert.equal(abcBadgeVariant('B'), 'warning');
});

test('value formatting marks quantity proxies', () => {
  assert.equal(formatCycleCountValue(180, 'purchase'), '180');
  assert.equal(formatCycleCountValue(28, 'qty_proxy'), '28 qty');
});

test('class toggles keep at least one selection', () => {
  assert.deepEqual(toggleAbcClass(['A'], 'B'), ['A', 'B']);
  assert.deepEqual(toggleAbcClass(['A', 'B'], 'A'), ['B']);
  assert.deepEqual(toggleAbcClass(['A'], 'A'), ['A']);
});
