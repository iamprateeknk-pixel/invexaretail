// Location switcher order: the admin moves one location up (-1) or down (+1).
// Returns the full id list in its new order, or null when the move is not possible
// (unknown id, or already first/last) so the caller can skip the request.
export function moveLocationId(ids, locationId, delta) {
  const from = ids.indexOf(locationId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
