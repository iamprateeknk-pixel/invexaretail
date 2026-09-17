"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const replenishment_js_1 = require("./replenishment.js");
(0, node_test_1.default)('warehouse stock is preferred for branch replenishment', () => {
    strict_1.default.deepEqual((0, replenishment_js_1.routeReplenishment)('store-a', 8, [
        { locationId: 'store-b', locationName: 'Store B', locationType: 'store', available: 20 },
        { locationId: 'basni', locationName: 'H.O. Basni', locationType: 'warehouse', available: 10 },
    ]), {
        action: 'TRANSFER', sourceLocationId: 'basni', sourceLocationName: 'H.O. Basni',
        suggestedTransferQty: 8, reason: 'Target can be restored from network stock.',
    });
});
(0, node_test_1.default)('partial network stock is used before purchase', () => {
    const route = (0, replenishment_js_1.routeReplenishment)('store-a', 8, [
        { locationId: 'basni', locationName: 'H.O. Basni', locationType: 'warehouse', available: 3 },
    ]);
    strict_1.default.equal(route.action, 'TRANSFER');
    strict_1.default.equal(route.suggestedTransferQty, 3);
    strict_1.default.match(route.reason, /purchase the remaining/);
});
(0, node_test_1.default)('purchase is recommended only when the network has no stock', () => {
    strict_1.default.equal((0, replenishment_js_1.routeReplenishment)('store-a', 5, []).action, 'PURCHASE');
    strict_1.default.equal((0, replenishment_js_1.routeReplenishment)('store-a', 0, []).action, 'NONE');
});
