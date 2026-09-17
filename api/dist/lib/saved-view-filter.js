"use strict";
// Blueprint "Folders/tags/views: saved smart folders/views" - a saved view
// stores a filter as data, not a query string, so it stays safe to store
// and replay against any item list. This module is the one place that
// interprets that data - deterministic, no DB access.
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesSavedViewFilter = matchesSavedViewFilter;
exports.applySavedViewFilter = applySavedViewFilter;
function matchesSavedViewFilter(item, filter) {
    if (filter.category && item.category !== filter.category)
        return false;
    if (filter.subcategory && item.subcategory !== filter.subcategory)
        return false;
    if (filter.tagIds?.length && !filter.tagIds.every((tagId) => item.tagIds.includes(tagId)))
        return false;
    if (filter.search) {
        const needle = filter.search.trim().toLowerCase();
        if (needle && !item.name.toLowerCase().includes(needle) && !item.code.toLowerCase().includes(needle))
            return false;
    }
    return true;
}
function applySavedViewFilter(items, filter) {
    return items.filter((item) => matchesSavedViewFilter(item, filter));
}
