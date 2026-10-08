import test from 'node:test';
import assert from 'node:assert/strict';
import { moveField, newCustomField } from './ImportColumnsEditor.jsx';

test('moveField swaps neighbours and ignores moves past either end', () => {
  const list = [{ label: 'a' }, { label: 'b' }, { label: 'c' }];
  assert.deepEqual(moveField(list, 1, -1).map((f) => f.label), ['b', 'a', 'c']);
  assert.deepEqual(moveField(list, 1, 1).map((f) => f.label), ['a', 'c', 'b']);
  assert.equal(moveField(list, 0, -1), list);
  assert.equal(moveField(list, 2, 1), list);
});

test('newCustomField picks a unique name and starts as an optional text column', () => {
  const first = newCustomField([]);
  assert.equal(first.label, 'New column 1');
  assert.equal(first.custom, true);
  assert.equal(first.required, false);
  const second = newCustomField([first]);
  assert.equal(second.label, 'New column 2');
});
