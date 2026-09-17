"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const qc_inspection_js_1 = require("./qc-inspection.js");
(0, node_test_1.default)('findTemplateForCategory prefers a category-specific template over a global one', () => {
    const global = { id: 'global', category: null, active: true };
    const specific = { id: 'electronics', category: 'Electronics', active: true };
    strict_1.default.equal((0, qc_inspection_js_1.findTemplateForCategory)([global, specific], 'Electronics')?.id, 'electronics');
    strict_1.default.equal((0, qc_inspection_js_1.findTemplateForCategory)([global, specific], 'Dairy')?.id, 'global');
});
(0, node_test_1.default)('findTemplateForCategory ignores an inactive template', () => {
    const inactive = { id: 'inactive', category: null, active: false };
    strict_1.default.equal((0, qc_inspection_js_1.findTemplateForCategory)([inactive], null), null);
});
(0, node_test_1.default)('findTemplateForCategory returns null when nothing matches', () => {
    const specific = { id: 'electronics', category: 'Electronics', active: true };
    strict_1.default.equal((0, qc_inspection_js_1.findTemplateForCategory)([specific], 'Dairy'), null);
});
(0, node_test_1.default)('evaluateInspection fails overall if any single check failed', () => {
    strict_1.default.equal((0, qc_inspection_js_1.evaluateInspection)({ SEAL_INTACT: 'PASS', PACKAGING_INTACT: 'FAIL' }), 'FAIL');
});
(0, node_test_1.default)('evaluateInspection passes when every check is PASS or NA', () => {
    strict_1.default.equal((0, qc_inspection_js_1.evaluateInspection)({ SEAL_INTACT: 'PASS', WEIGHT_MATCH: 'NA' }), 'PASS');
});
(0, node_test_1.default)('evaluateInspection passes an empty result set', () => {
    strict_1.default.equal((0, qc_inspection_js_1.evaluateInspection)({}), 'PASS');
});
