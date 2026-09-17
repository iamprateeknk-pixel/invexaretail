"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const order_routing_js_1 = require("./order-routing.js");
(0, node_test_1.default)('rankOrderCandidates prefers store locations over warehouses when no geo/SLA/cost is present', () => {
    const ranked = (0, order_routing_js_1.rankOrderCandidates)([
        { locationId: 'wh-1', locationName: 'H.O. Basni', locationType: 'warehouse' },
        { locationId: 'loc-2', locationName: 'Vaishali Nagar', locationType: 'store' },
        { locationId: 'loc-1', locationName: 'Gopalpura', locationType: 'store' },
    ]);
    strict_1.default.deepEqual(ranked.map((c) => c.locationId), ['loc-1', 'loc-2', 'wh-1']);
});
(0, node_test_1.default)('rankOrderCandidates is a pure sort - does not mutate the input array', () => {
    const input = [
        { locationId: 'wh-1', locationName: 'Warehouse', locationType: 'warehouse' },
        { locationId: 'loc-1', locationName: 'Store', locationType: 'store' },
    ];
    const original = [...input];
    (0, order_routing_js_1.rankOrderCandidates)(input);
    strict_1.default.deepEqual(input, original);
});
(0, node_test_1.default)('haversineKm is zero for the same point and ~1.1km for nearby Jodhpur coordinates', () => {
    strict_1.default.equal((0, order_routing_js_1.haversineKm)(26.2389, 73.0243, 26.2389, 73.0243), 0);
    const nearby = (0, order_routing_js_1.haversineKm)(26.2389, 73.0243, 26.2489, 73.0243);
    strict_1.default.ok(nearby > 1 && nearby < 1.3);
});
(0, node_test_1.default)('rankOrderCandidates prefers the closer store when customer coordinates are present', () => {
    const ranked = (0, order_routing_js_1.rankOrderCandidates)([
        { locationId: 'far', locationName: 'Far Store', locationType: 'store', latitude: 26.4, longitude: 73.1 },
        { locationId: 'near', locationName: 'Near Store', locationType: 'store', latitude: 26.24, longitude: 73.03 },
        { locationId: 'wh', locationName: 'Warehouse', locationType: 'warehouse', latitude: 27.0, longitude: 74.0 },
    ], { customerLatitude: 26.2389, customerLongitude: 73.0243 });
    strict_1.default.equal(ranked[0].locationId, 'near');
});
(0, node_test_1.default)('candidateRoutingScore penalises high SLA, shipping cost and open-order workload', () => {
    const base = {
        locationId: 'a',
        locationName: 'A',
        locationType: 'store',
        latitude: 26.24,
        longitude: 73.03,
        deliverySlaHours: 4,
        shippingCostPerKm: 8,
        openOrderCount: 2,
    };
    const busy = { ...base, locationId: 'b', locationName: 'B', deliverySlaHours: 48, shippingCostPerKm: 40, openOrderCount: 30 };
    const ctx = { customerLatitude: 26.2389, customerLongitude: 73.0243 };
    strict_1.default.ok((0, order_routing_js_1.candidateRoutingScore)(base, ctx) < (0, order_routing_js_1.candidateRoutingScore)(busy, ctx));
});
(0, node_test_1.default)('splitLinesAcrossLocations fills from ranked locations then reports remainder', () => {
    const availability = new Map([
        ['loc-1', new Map([['item-a', 4], ['item-b', 0]])],
        ['wh-1', new Map([['item-a', 10], ['item-b', 3]])],
    ]);
    const ranked = [
        { locationId: 'loc-1', locationName: 'Store', locationType: 'store' },
        { locationId: 'wh-1', locationName: 'Warehouse', locationType: 'warehouse' },
    ];
    const result = (0, order_routing_js_1.splitLinesAcrossLocations)([{ itemId: 'item-a', quantity: 6 }, { itemId: 'item-b', quantity: 5 }], ranked, availability);
    strict_1.default.deepEqual(result.splits, [
        { locationId: 'loc-1', lines: [{ itemId: 'item-a', quantity: 4 }] },
        { locationId: 'wh-1', lines: [{ itemId: 'item-a', quantity: 2 }, { itemId: 'item-b', quantity: 3 }] },
    ]);
    strict_1.default.deepEqual(result.remainder, [{ itemId: 'item-b', quantity: 2 }]);
});
(0, node_test_1.default)('splitLinesAcrossLocations is a no-op when one location can fill everything', () => {
    const availability = new Map([
        ['loc-1', new Map([['item-a', 10]])],
        ['wh-1', new Map([['item-a', 10]])],
    ]);
    const ranked = [
        { locationId: 'loc-1', locationName: 'Store', locationType: 'store' },
        { locationId: 'wh-1', locationName: 'Warehouse', locationType: 'warehouse' },
    ];
    const result = (0, order_routing_js_1.splitLinesAcrossLocations)([{ itemId: 'item-a', quantity: 3 }], ranked, availability);
    strict_1.default.deepEqual(result.splits, [{ locationId: 'loc-1', lines: [{ itemId: 'item-a', quantity: 3 }] }]);
    strict_1.default.deepEqual(result.remainder, []);
});
