"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const intelligence_actions_js_1 = require("./intelligence-actions.js");
const today = new Date('2026-09-15T00:00:00.000Z');
(0, node_test_1.default)('buildLotBlockRecommendations flags blocked lots still on hand and expired-but-available lots', () => {
    const recs = (0, intelligence_actions_js_1.buildLotBlockRecommendations)([
        { itemId: 'i1', itemName: 'Milk', lotId: 'l1', lotNo: 'L-1', locationId: 'loc-1', onHand: 6, status: 'BLOCKED' },
        { itemId: 'i2', itemName: 'Yoghurt', lotId: 'l2', lotNo: 'L-2', locationId: 'loc-1', onHand: 4, status: 'AVAILABLE', expiryDate: '2026-09-01' },
        { itemId: 'i3', itemName: 'Rice', lotId: 'l3', lotNo: 'L-3', locationId: 'loc-1', onHand: 0, status: 'BLOCKED' },
    ], today);
    strict_1.default.equal(recs.length, 2);
    strict_1.default.equal(recs[0].suggestedAction, 'BLOCK_LOT');
    strict_1.default.equal(recs[1].itemId, 'i2');
});
(0, node_test_1.default)('buildExpiryActionRecommendations write-off expired lots and markdown lots inside 7 days', () => {
    const recs = (0, intelligence_actions_js_1.buildExpiryActionRecommendations)([
        { itemId: 'i1', itemName: 'Milk', lotId: 'l1', lotNo: 'L-1', locationId: 'loc-1', onHand: 2, status: 'AVAILABLE', expiryDate: '2026-09-10' },
        { itemId: 'i2', itemName: 'Bread', lotId: 'l2', lotNo: 'L-2', locationId: 'loc-1', onHand: 8, status: 'AVAILABLE', expiryDate: '2026-09-18' },
        { itemId: 'i3', itemName: 'Rice', lotId: 'l3', lotNo: 'L-3', locationId: 'loc-1', onHand: 20, status: 'AVAILABLE', expiryDate: '2027-01-01' },
    ], today);
    strict_1.default.equal(recs[0].suggestedAction, 'WRITE_OFF');
    strict_1.default.equal(recs[1].suggestedAction, 'MARKDOWN');
    strict_1.default.equal(recs.length, 2);
    strict_1.default.equal((0, intelligence_actions_js_1.daysToExpiry)('2026-09-18', today), 3);
});
(0, node_test_1.default)('buildOverstockRecommendations transfers surplus to a location below min', () => {
    const recs = (0, intelligence_actions_js_1.buildOverstockRecommendations)([
        { itemId: 'i1', itemName: 'Rice', locationId: 'wh-1', locationName: 'Warehouse', onHand: 80, targetQty: 40, minQty: 10 },
        { itemId: 'i1', itemName: 'Rice', locationId: 'loc-1', locationName: 'Main Store', onHand: 2, targetQty: 20, minQty: 8 },
    ], 'wh-1');
    strict_1.default.equal(recs.length, 1);
    strict_1.default.equal(recs[0].destinationLocationId, 'loc-1');
    strict_1.default.equal(recs[0].suggestedTransferQty, 6);
});
(0, node_test_1.default)('buildOverstockRecommendations stays quiet when nobody is below min', () => {
    const recs = (0, intelligence_actions_js_1.buildOverstockRecommendations)([
        { itemId: 'i1', itemName: 'Rice', locationId: 'wh-1', locationName: 'Warehouse', onHand: 80, targetQty: 40, minQty: 10 },
        { itemId: 'i1', itemName: 'Rice', locationId: 'loc-1', locationName: 'Main Store', onHand: 20, targetQty: 20, minQty: 8 },
    ], 'wh-1');
    strict_1.default.deepEqual(recs, []);
});
