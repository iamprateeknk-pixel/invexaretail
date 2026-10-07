// Plan Area F / DataTable 2.0 foundation: the state every operational list shares, so a person
// learns one table and uses it everywhere. It lives in the URL hash query (back, refresh and
// shared links keep the filters) and in per-user saved views. Pure functions here; the hook
// and toolbar are thin wrappers.
//
// Saved views hold presentation only - search, filters, sort, density. They never hold
// permissions or scope, so a view can be shared without widening anyone's access.

export const DENSITIES = ['comfortable', 'compact'];

export const DEFAULT_TABLE_STATE = Object.freeze({ q: '', filter: '', sort: '', page: 1, size: 25, density: 'comfortable' });

const SORT_PATTERN = /^[A-Za-z][\w.]*:(asc|desc)$/;

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

/** URL query string (with or without a leading ?) -> table state, always valid. */
export function parseTableQuery(search = '', defaults = DEFAULT_TABLE_STATE) {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''));
  const sort = params.get('sort') ?? defaults.sort;
  const density = params.get('density') ?? defaults.density;
  return {
    q: (params.get('q') ?? defaults.q).slice(0, 200),
    filter: (params.get('filter') ?? defaults.filter).slice(0, 80),
    sort: SORT_PATTERN.test(sort) ? sort : defaults.sort,
    page: clampInt(params.get('page'), defaults.page, 1, 100_000),
    size: [10, 25, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : defaults.size,
    density: DENSITIES.includes(density) ? density : defaults.density,
  };
}

/** Table state -> query string containing only what differs from the defaults (short, shareable links). */
export function serializeTableQuery(state, defaults = DEFAULT_TABLE_STATE) {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults)) {
    if (state[key] !== undefined && state[key] !== defaults[key] && state[key] !== '') params.set(key, String(state[key]));
  }
  return params.toString();
}

/** Splits `#/section?a=b` into the section path and its query string. */
export function splitHash(hash = '') {
  const text = String(hash).replace(/^#/, '');
  const index = text.indexOf('?');
  return index < 0 ? { path: text, query: '' } : { path: text.slice(0, index), query: text.slice(index + 1) };
}

export function joinHash(path, query) {
  return query ? `#${path}?${query}` : `#${path}`;
}

// ---- saved views --------------------------------------------------------------------------

const VIEWS_KEY_PREFIX = 'invexa.tableViews.v1';
const MAX_VIEWS = 20;

export const viewsStorageKey = (userId, tableId) => `${VIEWS_KEY_PREFIX}.${userId || 'anonymous'}.${tableId}`;

function readJson(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A saved view's state is re-validated on every read: stored data is never trusted. */
export function loadSavedViews(storage, userId, tableId, defaults = DEFAULT_TABLE_STATE) {
  return readJson(storage, viewsStorageKey(userId, tableId))
    .filter((view) => view && typeof view.id === 'string' && typeof view.name === 'string' && view.name.trim())
    .slice(0, MAX_VIEWS)
    .map((view) => ({ id: view.id, name: view.name.trim().slice(0, 60), state: parseTableQuery(serializeTableQuery(view.state ?? {}, defaults), defaults) }));
}

function writeViews(storage, userId, tableId, views) {
  try {
    storage?.setItem(viewsStorageKey(userId, tableId), JSON.stringify(views));
  } catch {
    // Storage can be unavailable or full (private windows, quota): saved views are a convenience.
  }
}

/** Saves the current state under a name (replacing a view with the same name). Page is never saved. */
export function saveView(storage, userId, tableId, name, state, defaults = DEFAULT_TABLE_STATE) {
  const cleanName = String(name ?? '').trim().slice(0, 60);
  if (!cleanName) return loadSavedViews(storage, userId, tableId, defaults);
  const { page: _page, ...rest } = state;
  const existing = loadSavedViews(storage, userId, tableId, defaults);
  const kept = existing.filter((view) => view.name.toLowerCase() !== cleanName.toLowerCase());
  const next = [...kept, { id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: cleanName, state: { ...rest, page: 1 } }].slice(-MAX_VIEWS);
  writeViews(storage, userId, tableId, next);
  return loadSavedViews(storage, userId, tableId, defaults);
}

export function deleteView(storage, userId, tableId, viewId, defaults = DEFAULT_TABLE_STATE) {
  const next = loadSavedViews(storage, userId, tableId, defaults).filter((view) => view.id !== viewId);
  writeViews(storage, userId, tableId, next);
  return next;
}

// ---- client-side search -------------------------------------------------------------------

/** Rows whose searchable text (from `getFields(row)`) contains every word of the query. */
export function filterRows(rows, query, getFields) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return (rows ?? []).filter((row) => {
    const text = getFields(row).map((value) => String(value ?? '').toLowerCase()).join(' ');
    return words.every((word) => text.includes(word));
  });
}

// ---- URL hash binding ---------------------------------------------------------------------

/** The table state carried by `#/section?q=..&density=..` (defaults when the hash has no query). */
export function readTableStateFromHash(hash, defaults = DEFAULT_TABLE_STATE) {
  return parseTableQuery(splitHash(hash).query, defaults);
}

/** The same hash with its query replaced by `state` (section path untouched, defaults omitted). */
export function hashWithTableState(hash, state, defaults = DEFAULT_TABLE_STATE) {
  return joinHash(splitHash(hash).path, serializeTableQuery(state, defaults));
}
