import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hiddenColumnCss, hiddenColumnIds, toggleColumn,
  DEFAULT_TABLE_STATE, deleteView, joinHash, loadSavedViews, parseTableQuery, saveView, serializeTableQuery, splitHash, viewsStorageKey,
} from './table-state.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (key) => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = value; }, data };
}

test('defaults serialize to an empty query, and an empty query parses to the defaults', () => {
  assert.equal(serializeTableQuery(DEFAULT_TABLE_STATE), '');
  assert.deepEqual(parseTableQuery(''), DEFAULT_TABLE_STATE);
});

test('only what differs from the defaults goes in the URL, and it round-trips', () => {
  const state = { ...DEFAULT_TABLE_STATE, q: 'rice', filter: 'OPEN', sort: 'dueAt:asc', page: 3, size: 50, density: 'compact' };
  const query = serializeTableQuery(state);
  assert.equal(query, 'q=rice&filter=OPEN&sort=dueAt%3Aasc&page=3&size=50&density=compact');
  assert.deepEqual(parseTableQuery(query), state);
  assert.deepEqual(parseTableQuery(`?${query}`), state);
});

test('hostile or malformed query values fall back to safe defaults', () => {
  const state = parseTableQuery('sort=; DROP TABLE x&page=-5&size=9999&density=huge&q=' + 'a'.repeat(500));
  assert.equal(state.sort, '');
  assert.equal(state.page, 1);
  assert.equal(state.size, 25);
  assert.equal(state.density, 'comfortable');
  assert.equal(state.q.length, 200);
  assert.equal(parseTableQuery('page=abc').page, 1);
  assert.equal(parseTableQuery('sort=name:sideways').sort, '');
  assert.equal(parseTableQuery('sort=name:desc').sort, 'name:desc');
});

test('custom defaults are respected (a table that starts sorted or filtered)', () => {
  const defaults = { ...DEFAULT_TABLE_STATE, sort: 'dueAt:asc', filter: 'OPEN' };
  assert.equal(serializeTableQuery(defaults, defaults), '');
  assert.equal(parseTableQuery('', defaults).filter, 'OPEN');
  assert.equal(serializeTableQuery({ ...defaults, filter: 'CLOSED' }, defaults), 'filter=CLOSED');
});

test('hash helpers keep the section path and its query apart', () => {
  assert.deepEqual(splitHash('#/exceptions?filter=OPEN&page=2'), { path: '/exceptions', query: 'filter=OPEN&page=2' });
  assert.deepEqual(splitHash('#/exceptions'), { path: '/exceptions', query: '' });
  assert.equal(joinHash('/exceptions', 'filter=OPEN'), '#/exceptions?filter=OPEN');
  assert.equal(joinHash('/exceptions', ''), '#/exceptions');
});

test('saved views are per user and per table, and never include the page number', () => {
  const storage = memoryStorage();
  saveView(storage, 'alice', 'exceptions', 'My open work', { ...DEFAULT_TABLE_STATE, filter: 'OPEN', page: 7, density: 'compact' });
  const aliceViews = loadSavedViews(storage, 'alice', 'exceptions');
  assert.equal(aliceViews.length, 1);
  assert.equal(aliceViews[0].name, 'My open work');
  assert.equal(aliceViews[0].state.filter, 'OPEN');
  assert.equal(aliceViews[0].state.density, 'compact');
  assert.equal(aliceViews[0].state.page, 1);
  assert.deepEqual(loadSavedViews(storage, 'bob', 'exceptions'), [], 'another user sees none of them');
  assert.deepEqual(loadSavedViews(storage, 'alice', 'inventory'), [], 'another table sees none of them');
  assert.notEqual(viewsStorageKey('alice', 'exceptions'), viewsStorageKey('bob', 'exceptions'));
});

test('saving under an existing name replaces it; delete removes only that view; blank names are ignored', () => {
  const storage = memoryStorage();
  saveView(storage, 'alice', 't', 'Mine', { ...DEFAULT_TABLE_STATE, filter: 'OPEN' });
  saveView(storage, 'alice', 't', 'mine', { ...DEFAULT_TABLE_STATE, filter: 'CLOSED' });
  let views = loadSavedViews(storage, 'alice', 't');
  assert.equal(views.length, 1);
  assert.equal(views[0].state.filter, 'CLOSED');
  saveView(storage, 'alice', 't', 'Other', DEFAULT_TABLE_STATE);
  saveView(storage, 'alice', 't', '   ', DEFAULT_TABLE_STATE);
  views = loadSavedViews(storage, 'alice', 't');
  assert.equal(views.length, 2);
  views = deleteView(storage, 'alice', 't', views.find((view) => view.name === 'Other').id);
  assert.deepEqual(views.map((view) => view.name), ['mine']);
});

test('stored data is never trusted: corrupt JSON, wrong shapes and hostile state are cleaned up', () => {
  const key = viewsStorageKey('alice', 't');
  assert.deepEqual(loadSavedViews(memoryStorage({ [key]: '{not json' }), 'alice', 't'), []);
  assert.deepEqual(loadSavedViews(memoryStorage({ [key]: '{"a":1}' }), 'alice', 't'), []);
  const hostile = JSON.stringify([{ id: 'v1', name: '  Ok  ', state: { sort: 'x;y', density: 'enormous', page: 99, size: 1 } }, { id: 5, name: 'bad' }, null]);
  const views = loadSavedViews(memoryStorage({ [key]: hostile }), 'alice', 't');
  assert.equal(views.length, 1);
  assert.equal(views[0].name, 'Ok');
  assert.equal(views[0].state.sort, '');
  assert.equal(views[0].state.density, 'comfortable');
});

test('storage that throws (private window, quota) never breaks the table', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadSavedViews(broken, 'alice', 't'), []);
  assert.doesNotThrow(() => saveView(broken, 'alice', 't', 'x', DEFAULT_TABLE_STATE));
  assert.deepEqual(loadSavedViews(undefined, 'alice', 't'), []);
});

test('filterRows matches every word across the chosen fields, and returns all rows for an empty query', async () => {
  const { filterRows } = await import('./table-state.js');
  const rows = [{ a: 'Rice bag', b: 'Delhi' }, { a: 'Rice sack', b: 'Pune' }, { a: 'Milk', b: null }];
  const fields = (row) => [row.a, row.b];
  assert.equal(filterRows(rows, '', fields), rows);
  assert.deepEqual(filterRows(rows, 'rice pune', fields).map((r) => r.a), ['Rice sack']);
  assert.deepEqual(filterRows(rows, '  MILK ', fields).map((r) => r.a), ['Milk']);
  assert.deepEqual(filterRows(rows, 'nothing', fields), []);
  assert.deepEqual(filterRows(undefined, 'x', fields), []);
});

test('table state round-trips through the location hash without touching the section path', async () => {
  const { readTableStateFromHash, hashWithTableState } = await import('./table-state.js');
  assert.deepEqual(readTableStateFromHash('#/orders'), DEFAULT_TABLE_STATE);
  const hash = hashWithTableState('#/orders', { ...DEFAULT_TABLE_STATE, q: 'web store', density: 'compact' });
  assert.equal(hash, '#/orders?q=web+store&density=compact');
  assert.deepEqual(readTableStateFromHash(hash), { ...DEFAULT_TABLE_STATE, q: 'web store', density: 'compact' });
  assert.equal(hashWithTableState(hash, DEFAULT_TABLE_STATE), '#/orders', 'defaults leave a clean URL');
  assert.equal(hashWithTableState('#/orders?q=old', { ...DEFAULT_TABLE_STATE, q: 'new' }), '#/orders?q=new', 'an old query is replaced, not appended');
});

test('hidden columns round-trip through the URL and hostile ids are dropped', () => {
  const state = { ...DEFAULT_TABLE_STATE, cols: 'cartons,route' };
  const query = serializeTableQuery(state);
  assert.equal(query, 'cols=cartons%2Croute');
  assert.deepEqual(parseTableQuery(query).cols, 'cartons,route');
  assert.equal(parseTableQuery('cols=ok,<script>,a b,drop;table').cols, 'ok');
  assert.equal(parseTableQuery('').cols, '');
});

test('toggling a column hides or shows it but always leaves one column visible', () => {
  const all = ['item', 'route', 'qty'];
  let state = toggleColumn(DEFAULT_TABLE_STATE, 'route', all);
  assert.equal(state.cols, 'route');
  assert.deepEqual([...hiddenColumnIds(state)], ['route']);
  state = toggleColumn(state, 'qty', all);
  assert.equal(state.cols, 'route,qty');
  assert.equal(toggleColumn(state, 'item', all).cols, 'route,qty', 'the last visible column cannot be hidden');
  assert.equal(toggleColumn(state, 'route', all).cols, 'qty', 'toggling a hidden column shows it again');
});

test('hiddenColumnCss targets the right cells, honouring a leading checkbox column', () => {
  const css = hiddenColumnCss('tv-x', ['item', 'route', 'qty'], new Set(['route']), 1);
  assert.equal(css, '.tv-x th:nth-child(3),.tv-x td:nth-child(3){display:none}');
  assert.equal(hiddenColumnCss('tv-x', ['item'], new Set()), '');
});

test('toTeamViews keeps shared server rows, re-validates their state and drops malformed ones', async () => {
  const { toTeamViews } = await import('./table-state.js');
  const views = toTeamViews([
    { id: 'a', name: '  Overdue  ', ownerId: 'u1', isShared: true, filter: { q: 'late', density: 'compact', page: 9, evil: 'x' } },
    { id: 'b', name: '', isShared: true, filter: {} },
    { id: 'c', name: 'Private', isShared: false, filter: {} },
    null,
  ]);
  assert.deepEqual(views.map((view) => view.name), ['Overdue']);
  assert.equal(views[0].state.q, 'late');
  assert.equal(views[0].state.density, 'compact');
  assert.equal(views[0].state.evil, undefined);
  assert.deepEqual(toTeamViews(undefined), []);
});
