"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const shelf_life_js_1 = require("./shelf-life.js");
(0, node_test_1.default)('zones are relative to the product\'s own shelf life, not a fixed day count', () => {
    // 3 days left: a 5-day product is at 60% (yellow) but a 365-day product is critical.
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(3, 5), 'YELLOW');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(3, 365), 'CRITICAL');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(70, 100), 'GREEN');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(67, 100), 'YELLOW');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(20, 100), 'RED');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(10, 100), 'CRITICAL');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(-1, 100), 'EXPIRED');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(5, null), null, 'unknown shelf life gives no zone rather than a guess');
    strict_1.default.equal((0, shelf_life_js_1.shelfLifeZone)(-1, null), 'EXPIRED');
    strict_1.default.equal((0, shelf_life_js_1.remainingShelfLifePercent)(30, 120), 25);
});
(0, node_test_1.default)('sell-through: stock that will not sell before expiry is at risk', () => {
    // 100 units, 2/day, 10 days left -> window 11 days -> sells 22, 78 at risk.
    const risky = (0, shelf_life_js_1.projectSellThrough)({ onHand: 100, avgDailyDemand: 2, daysUntilExpiry: 10 });
    strict_1.default.equal(risky.expectedSoldBeforeExpiry, 22);
    strict_1.default.equal(risky.atRiskQty, 78);
    strict_1.default.equal(risky.willSellOut, false);
    strict_1.default.equal(risky.daysToSellOut, 50);
});
(0, node_test_1.default)('sell-through: fast movers are safe, no demand means everything is at risk, expiring today gets one selling day', () => {
    strict_1.default.equal((0, shelf_life_js_1.projectSellThrough)({ onHand: 20, avgDailyDemand: 5, daysUntilExpiry: 10 }).willSellOut, true);
    const dead = (0, shelf_life_js_1.projectSellThrough)({ onHand: 12, avgDailyDemand: 0, daysUntilExpiry: 30 });
    strict_1.default.equal(dead.atRiskQty, 12);
    strict_1.default.equal(dead.daysToSellOut, null);
    strict_1.default.equal((0, shelf_life_js_1.projectSellThrough)({ onHand: 9, avgDailyDemand: 3, daysUntilExpiry: 0 }).atRiskQty, 6);
});
