import assert from 'node:assert/strict';
import test from 'node:test';
import { NAVIGATION } from './workspace.js';

test('no navigation entry shows an internal priority label to operators', () => {
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      assert.ok(!item.badge || !/^P\d$/i.test(item.badge), `${item.id} shows the internal label "${item.badge}"`);
    }
  }
});
