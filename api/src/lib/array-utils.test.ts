import test from 'node:test';
import assert from 'node:assert/strict';
import { pushAll, replaceContents } from './array-utils.js';

test('the spread form really does overflow at this size (the bug these helpers avoid)', () => {
  const big = Array.from({ length: 400_000 }, (_, i) => i);
  assert.throws(() => [].splice(0, 0, ...big), RangeError);
});

test('replaceContents handles hundreds of thousands of rows and keeps the same array object', () => {
  const holder: number[] = [1, 2, 3];
  const reference = holder;
  const big = Array.from({ length: 400_000 }, (_, i) => i);
  replaceContents(holder, big);
  assert.equal(holder, reference, 'callers hold references, so it must mutate in place');
  assert.equal(holder.length, 400_000);
  assert.equal(holder[0], 0);
  assert.equal(holder[399_999], 399_999);
});

test('replaceContents with an empty source empties the target', () => {
  const holder = [1, 2];
  replaceContents(holder, []);
  assert.deepEqual(holder, []);
});

test('replaceContents is safe when the source is the target itself', () => {
  const holder = [1, 2, 3];
  replaceContents(holder, holder);
  assert.deepEqual(holder, [1, 2, 3]);
});

test('pushAll appends in order across chunk boundaries', () => {
  const holder: number[] = [-1];
  pushAll(holder, Array.from({ length: 25_000 }, (_, i) => i));
  assert.equal(holder.length, 25_001);
  assert.equal(holder[1], 0);
  assert.equal(holder.at(-1), 24_999);
});
