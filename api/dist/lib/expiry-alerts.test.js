"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const expiry_alerts_js_1 = require("./expiry-alerts.js");
(0, node_test_1.default)('expiry day calculation is calendar-day based', () => {
    strict_1.default.equal((0, expiry_alerts_js_1.daysUntilExpiry)(new Date('2026-09-13T23:59:00Z'), new Date('2026-09-13T01:00:00Z')), 0);
    strict_1.default.equal((0, expiry_alerts_js_1.daysUntilExpiry)(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-13T23:00:00Z')), 7);
});
(0, node_test_1.default)('expiry severity boundaries are deterministic', () => {
    strict_1.default.equal((0, expiry_alerts_js_1.expirySeverity)(-1), 'EXPIRED');
    strict_1.default.equal((0, expiry_alerts_js_1.expirySeverity)(7), 'CRITICAL');
    strict_1.default.equal((0, expiry_alerts_js_1.expirySeverity)(30), 'WARNING');
    strict_1.default.equal((0, expiry_alerts_js_1.expirySeverity)(31), 'UPCOMING');
    strict_1.default.match((0, expiry_alerts_js_1.recommendedExpiryAction)(-1), /write-off/);
    strict_1.default.match((0, expiry_alerts_js_1.recommendedExpiryAction)(Number.POSITIVE_INFINITY), /expiry date/);
});
