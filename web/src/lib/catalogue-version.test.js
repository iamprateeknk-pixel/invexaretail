import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalogueIfChanged } from './catalogue-version.js';

const make = (version, items = [{ id: 'i1' }]) => {
  const calls = { items: 0 };
  return { calls, fetchVersion: async () => version, fetchItems: async () => { calls.items += 1; return items; } };
};

test('an unchanged version skips the catalogue fetch entirely', async () => {
  const stub = make('v1');
  const result = await loadCatalogueIfChanged({ lastVersion: 'v1', ...stub });
  assert.deepEqual(result, { items: null, version: 'v1' });
  assert.equal(stub.calls.items, 0);
});

test('a moved version refetches and reports the new version', async () => {
  const stub = make('v2', [{ id: 'a' }, { id: 'b' }]);
  const result = await loadCatalogueIfChanged({ lastVersion: 'v1', ...stub });
  assert.equal(result.version, 'v2');
  assert.equal(result.items.length, 2);
  assert.equal(stub.calls.items, 1);
});

test('the first load (no version held yet) always fetches', async () => {
  const stub = make('v1');
  assert.equal((await loadCatalogueIfChanged({ lastVersion: null, ...stub })).items.length, 1);
});

test('an unknown server version (null) always refetches, even when nothing is held', async () => {
  const stub = make(null);
  assert.equal((await loadCatalogueIfChanged({ lastVersion: null, ...stub })).items.length, 1);
  assert.equal((await loadCatalogueIfChanged({ lastVersion: 'v1', ...stub })).items.length, 1);
  assert.equal(stub.calls.items, 2);
});

test('a failed catalogue fetch propagates so the caller keeps its held copy and old version', async () => {
  const failing = { fetchVersion: async () => 'v9', fetchItems: async () => { throw new Error('offline'); } };
  await assert.rejects(() => loadCatalogueIfChanged({ lastVersion: 'v1', ...failing }), /offline/);
});
