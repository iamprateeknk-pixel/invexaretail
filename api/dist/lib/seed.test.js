"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const seed_js_1 = require("./seed.js");
(0, node_test_1.default)('seed data includes all required roles and locations', () => {
    strict_1.default.ok(seed_js_1.seedUsers.some((user) => user.role === 'ADMIN'));
    strict_1.default.ok(seed_js_1.seedUsers.some((user) => user.role === 'BRANCH_MANAGER'));
    strict_1.default.ok(seed_js_1.seedUsers.some((user) => user.role === 'STORE_USER'));
    strict_1.default.ok(seed_js_1.seedUsers.some((user) => user.role === 'WAREHOUSE_PICKER'));
    strict_1.default.ok(seed_js_1.seedUsers.some((user) => user.role === 'AUDITOR'));
    strict_1.default.ok(seed_js_1.seedLocations.some((location) => location.id === 'wh-1'));
});
(0, node_test_1.default)('seed data includes stock and transfer records', () => {
    strict_1.default.ok(seed_js_1.seedItems.length >= 2);
    strict_1.default.ok(seed_js_1.seedCounts.length >= 1);
    strict_1.default.ok(seed_js_1.seedTransfers.length >= 1);
});
(0, node_test_1.default)('seed lots include expired, near-expiry and missing dates plus reorder rules', () => {
    strict_1.default.ok(seed_js_1.seedItems.some((item) => item.lots.some((lot) => lot.expiryDate === '2026-09-01')));
    strict_1.default.ok(seed_js_1.seedItems.some((item) => item.lots.some((lot) => lot.expiryDate === '2026-09-18')));
    strict_1.default.ok(seed_js_1.seedItems.some((item) => item.lots.some((lot) => lot.expiryDate == null)));
    strict_1.default.ok(seed_js_1.seedReorderRules.some((rule) => rule.itemId === 'item-1001' && rule.targetQty === 50));
});
