// Blueprint "Folders/tags/views: saved smart folders/views" - a saved view
// stores a filter as data, not a query string, so it stays safe to store
// and replay against any item list. This module is the one place that
// interprets that data - deterministic, no DB access.

export type SavedViewFilterConfig = {
  tagIds?: string[];
  category?: string | null;
  subcategory?: string | null;
  search?: string | null;
};

export type SavedViewFilterableItem = {
  id: string;
  name: string;
  code: string;
  category?: string | null;
  subcategory?: string | null;
  tagIds: string[];
};

export function matchesSavedViewFilter(item: SavedViewFilterableItem, filter: SavedViewFilterConfig): boolean {
  if (filter.category && item.category !== filter.category) return false;
  if (filter.subcategory && item.subcategory !== filter.subcategory) return false;
  if (filter.tagIds?.length && !filter.tagIds.every((tagId) => item.tagIds.includes(tagId))) return false;
  if (filter.search) {
    const needle = filter.search.trim().toLowerCase();
    if (needle && !item.name.toLowerCase().includes(needle) && !item.code.toLowerCase().includes(needle)) return false;
  }
  return true;
}

export function applySavedViewFilter<T extends SavedViewFilterableItem>(items: T[], filter: SavedViewFilterConfig): T[] {
  return items.filter((item) => matchesSavedViewFilter(item, filter));
}
