"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const saved_view_filter_js_1 = require("./saved-view-filter.js");
const items = [
    { id: '1', name: 'Red Shirt', code: 'RS-01', category: 'Apparel', subcategory: 'Shirts', tagIds: ['fast-mover', 'summer'] },
    { id: '2', name: 'Blue Jeans', code: 'BJ-02', category: 'Apparel', subcategory: 'Jeans', tagIds: ['slow-mover'] },
    { id: '3', name: 'Steel Bolt', code: 'SB-03', category: 'Hardware', subcategory: null, tagIds: [] },
];
(0, node_test_1.default)('an empty filter matches everything', () => {
    strict_1.default.equal((0, saved_view_filter_js_1.applySavedViewFilter)(items, {}).length, 3);
});
(0, node_test_1.default)('category filter narrows to matching items only', () => {
    const result = (0, saved_view_filter_js_1.applySavedViewFilter)(items, { category: 'Apparel' });
    strict_1.default.deepEqual(result.map((item) => item.id), ['1', '2']);
});
(0, node_test_1.default)('tag filter requires every listed tag to be present', () => {
    strict_1.default.equal((0, saved_view_filter_js_1.matchesSavedViewFilter)(items[0], { tagIds: ['fast-mover', 'summer'] }), true);
    strict_1.default.equal((0, saved_view_filter_js_1.matchesSavedViewFilter)(items[0], { tagIds: ['fast-mover', 'winter'] }), false);
});
(0, node_test_1.default)('search matches name or code, case-insensitively', () => {
    strict_1.default.equal((0, saved_view_filter_js_1.matchesSavedViewFilter)(items[0], { search: 'red' }), true);
    strict_1.default.equal((0, saved_view_filter_js_1.matchesSavedViewFilter)(items[0], { search: 'rs-01' }), true);
    strict_1.default.equal((0, saved_view_filter_js_1.matchesSavedViewFilter)(items[0], { search: 'jeans' }), false);
});
(0, node_test_1.default)('subcategory and category combine as AND, not OR', () => {
    const result = (0, saved_view_filter_js_1.applySavedViewFilter)(items, { category: 'Apparel', subcategory: 'Jeans' });
    strict_1.default.deepEqual(result.map((item) => item.id), ['2']);
});
(0, node_test_1.default)('an item with no tags never matches a tag filter', () => {
    strict_1.default.equal((0, saved_view_filter_js_1.matchesSavedViewFilter)(items[2], { tagIds: ['fast-mover'] }), false);
});
