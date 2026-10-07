import test from 'node:test';
import assert from 'node:assert/strict';
import { entityFromHash, entityHref, relatedHref } from './entity-360.js';

test('entity links round-trip through the hash, with ids safely encoded', () => {
  assert.equal(entityHref('lot', 'abc'), '#/entity?type=lot&id=abc');
  assert.deepEqual(entityFromHash(entityHref('transfer', 'cm x/1')), { type: 'transfer', id: 'cm x/1' });
});

test('only known entity types with an id are accepted', () => {
  assert.equal(entityFromHash('#/entity?type=spaceship&id=1'), null);
  assert.equal(entityFromHash('#/entity?type=lot'), null);
  assert.equal(entityFromHash('#/orders?type=lot&id=1'), null);
  assert.equal(entityFromHash(`#/entity?type=lot&id=${'x'.repeat(201)}`), null);
  assert.equal(entityFromHash(''), null);
});

test('related rows link to another 360 view or to the list that owns the record', () => {
  assert.equal(relatedHref({ kind: 'location', id: 'l1' }), '#/entity?type=location&id=l1');
  assert.equal(relatedHref({ kind: 'exception', id: 'e1' }), '#/exceptions');
  assert.equal(relatedHref({ kind: 'item', id: 'i1' }), '#/item-search');
  assert.equal(relatedHref({ kind: 'mystery', id: 'x' }), null);
});
