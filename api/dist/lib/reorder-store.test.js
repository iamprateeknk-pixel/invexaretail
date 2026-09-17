"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const reorder_store_js_1 = require("./reorder-store.js");
(0, node_test_1.default)('seed reorder rules prefer warehouse transfer then purchase', () => {
    (0, reorder_store_js_1.resetReorderStore)();
    const intelligence = (0, reorder_store_js_1.buildReplenishmentIntelligence)('loc-1');
    const rice = intelligence.recommendations.find((entry) => entry.itemId === 'item-1001');
    const flour = intelligence.recommendations.find((entry) => entry.itemId === 'item-1006');
    strict_1.default.ok(rice);
    strict_1.default.equal(rice.suggestedAction, 'TRANSFER');
    strict_1.default.equal(rice.sourceLocationId, 'wh-1');
    strict_1.default.equal(rice.suggestedOrderQty, 22);
    strict_1.default.equal(rice.suggestedTransferQty, 22);
    strict_1.default.ok(flour);
    strict_1.default.equal(flour.suggestedAction, 'PURCHASE');
    strict_1.default.match(intelligence.executiveSummary, /transfer/i);
});
(0, node_test_1.default)('reorder rules can be upserted for a location', () => {
    (0, reorder_store_js_1.resetReorderStore)();
    const created = (0, reorder_store_js_1.upsertReorderRule)({ itemId: 'item-1002', locationId: 'loc-1', minQty: 5, targetQty: 12 });
    strict_1.default.equal(created.minQty, 5);
    const updated = (0, reorder_store_js_1.upsertReorderRule)({ itemId: 'item-1002', locationId: 'loc-1', minQty: 6, targetQty: 15 });
    strict_1.default.equal(updated.targetQty, 15);
    strict_1.default.equal((0, reorder_store_js_1.listReorderRules)('loc-1').filter((rule) => rule.itemId === 'item-1002').length, 1);
    strict_1.default.throws(() => (0, reorder_store_js_1.upsertReorderRule)({ itemId: 'item-1002', locationId: 'loc-1', minQty: 20, targetQty: 10 }));
    (0, reorder_store_js_1.resetReorderStore)();
});
