import test from 'node:test';
import assert from 'node:assert/strict';
import { featureForOperationalPath } from './kill-switch.js';

test('inventory, WMS and OMS paths map to killable features', () => {
  assert.equal(featureForOperationalPath('/items'), 'INVENTORY');
  assert.equal(featureForOperationalPath('/stock/loc-1'), 'INVENTORY');
  assert.equal(featureForOperationalPath('/counts'), 'INVENTORY');
  assert.equal(featureForOperationalPath('/transfers'), 'WMS');
  assert.equal(featureForOperationalPath('/waves/pick'), 'WMS');
  assert.equal(featureForOperationalPath('/orders'), 'OMS');
  assert.equal(featureForOperationalPath('/auth/login'), null);
  assert.equal(featureForOperationalPath('/users'), null);
});
