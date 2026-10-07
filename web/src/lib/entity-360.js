// Entity 360 links and hash parsing. A 360 view lives at `#/entity?type=lot&id=...`, so it can be
// bookmarked, shared and reached with the back button like every other view.
import { splitHash } from './table-state.js';

export const ENTITY_TYPES = ['lot', 'location', 'transfer', 'count', 'user'];

export function entityHref(type, id) {
  return `#/entity?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
}

/** { type, id } from the current hash, or null when it does not name a known entity. */
export function entityFromHash(hash = '') {
  const { path, query } = splitHash(hash);
  if (path.replace(/^\//, '') !== 'entity') return null;
  const params = new URLSearchParams(query);
  const type = params.get('type') ?? '';
  const id = params.get('id') ?? '';
  return ENTITY_TYPES.includes(type) && id && id.length <= 200 ? { type, id } : null;
}

/** Where a related-record row should link: another 360 view, or the list that owns that kind of record. */
export function relatedHref(related) {
  if (ENTITY_TYPES.includes(related.kind)) return entityHref(related.kind, related.id);
  if (related.kind === 'exception') return '#/exceptions';
  if (related.kind === 'item') return '#/item-search';
  if (related.kind === 'count-task') return '#/counts';
  return null;
}
