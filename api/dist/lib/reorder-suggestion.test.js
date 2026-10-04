"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const reorder_suggestion_js_1 = require("./reorder-suggestion.js");
const steady = Array.from({ length: 30 }, () => 10);
(0, node_test_1.default)('steady demand gives min = demand x lead time and a target one cover period higher', () => {
    const s = (0, reorder_suggestion_js_1.suggestReorderRule)({ itemId: 'a', dailyDemand: steady, leadTimeDays: 5, coverDays: 7 });
    strict_1.default.equal(s.suggestedMin, 50);
    strict_1.default.equal(s.suggestedTarget, 120);
    strict_1.default.equal(s.change, 'NEW');
});
(0, node_test_1.default)('no demand history yields no suggestion instead of a zero rule', () => {
    strict_1.default.equal((0, reorder_suggestion_js_1.suggestReorderRule)({ itemId: 'a', dailyDemand: [0, 0, 0], leadTimeDays: 5 }), null);
});
(0, node_test_1.default)('variable demand adds safety stock and an existing rule far below target is flagged INCREASE', () => {
    const noisy = Array.from({ length: 30 }, (_, i) => (i % 2 ? 2 : 18));
    const s = (0, reorder_suggestion_js_1.suggestReorderRule)({ itemId: 'a', dailyDemand: noisy, leadTimeDays: 5, currentMin: 10, currentTarget: 20 });
    strict_1.default.ok(s.safetyStock > 0);
    strict_1.default.equal(s.change, 'INCREASE');
    strict_1.default.equal((0, reorder_suggestion_js_1.suggestReorderRule)({ itemId: 'a', dailyDemand: steady, leadTimeDays: 5, coverDays: 7, currentMin: 50, currentTarget: 120 }).change, 'OK');
});
(0, node_test_1.default)('decimal items keep fractions, counted items round up', () => {
    const d = Array.from({ length: 30 }, () => 0.35);
    strict_1.default.equal((0, reorder_suggestion_js_1.suggestReorderRule)({ itemId: 'a', dailyDemand: d, leadTimeDays: 3, decimal: false }).suggestedMin, 2);
    strict_1.default.equal((0, reorder_suggestion_js_1.suggestReorderRule)({ itemId: 'a', dailyDemand: d, leadTimeDays: 3, decimal: true }).suggestedMin, 1.05);
});
