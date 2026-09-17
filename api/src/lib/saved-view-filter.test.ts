import test from 'node:test';
import assert from 'node:assert/strict';
import { applySavedViewFilter, matchesSavedViewFilter } from './saved-view-filter.js';

const items = [
  { id: '1', name: 'Red Shirt', code: 'RS-01', category: 'Apparel', subcategory: 'Shirts', tagIds: ['fast-mover', 'summer'] },
  { id: '2', name: 'Blue Jeans', code: 'BJ-02', category: 'Apparel', subcategory: 'Jeans', tagIds: ['slow-mover'] },
  { id: '3', name: 'Steel Bolt', code: 'SB-03', category: 'Hardware', subcategory: null, tagIds: [] },
];

test('an empty filter matches everything', () => {
  assert.equal(applySavedViewFilter(items, {}).length, 3);
});

test('category filter narrows to matching items only', () => {
  const result = applySavedViewFilter(items, { category: 'Apparel' });
  assert.deepEqual(result.map((item) => item.id), ['1', '2']);
});

test('tag filter requires every listed tag to be present', () => {
  assert.equal(matchesSavedViewFilter(items[0], { tagIds: ['fast-mover', 'summer'] }), true);
  assert.equal(matchesSavedViewFilter(items[0], { tagIds: ['fast-mover', 'winter'] }), false);
});

test('search matches name or code, case-insensitively', () => {
  assert.equal(matchesSavedViewFilter(items[0], { search: 'red' }), true);
  assert.equal(matchesSavedViewFilter(items[0], { search: 'rs-01' }), true);
  assert.equal(matchesSavedViewFilter(items[0], { search: 'jeans' }), false);
});

test('subcategory and category combine as AND, not OR', () => {
  const result = applySavedViewFilter(items, { category: 'Apparel', subcategory: 'Jeans' });
  assert.deepEqual(result.map((item) => item.id), ['2']);
});

test('an item with no tags never matches a tag filter', () => {
  assert.equal(matchesSavedViewFilter(items[2], { tagIds: ['fast-mover'] }), false);
});
