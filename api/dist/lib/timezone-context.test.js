"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const timezone_context_js_1 = require("./timezone-context.js");
const expiry_date_js_1 = require("./expiry-date.js");
(0, node_test_1.default)('unknown or invalid zones are rejected and fall back to the default', () => {
    strict_1.default.equal((0, timezone_context_js_1.validTimezone)('Not/AZone'), null);
    (0, timezone_context_js_1.cacheCompanyTimezone)('co-bad', 'Not/AZone');
    strict_1.default.equal((0, timezone_context_js_1.companyTimezone)('co-bad'), timezone_context_js_1.BUSINESS_TIMEZONE);
    strict_1.default.equal((0, timezone_context_js_1.companyTimezone)(undefined), timezone_context_js_1.BUSINESS_TIMEZONE);
});
(0, node_test_1.default)('the request scope carries its own company zone and does not leak to other scopes', () => {
    (0, timezone_context_js_1.cacheCompanyTimezone)('co-ny', 'America/New_York');
    (0, timezone_context_js_1.runWithCompanyTimezone)('co-ny', () => strict_1.default.equal((0, timezone_context_js_1.currentTimezone)(), 'America/New_York'));
    strict_1.default.equal((0, timezone_context_js_1.currentTimezone)(), timezone_context_js_1.BUSINESS_TIMEZONE);
});
(0, node_test_1.default)('the same instant is a different calendar day per company, so expiry flips at each company\'s own midnight', () => {
    (0, timezone_context_js_1.cacheCompanyTimezone)('co-ist', 'Asia/Kolkata');
    (0, timezone_context_js_1.cacheCompanyTimezone)('co-la', 'America/Los_Angeles');
    // 2026-09-26 02:00 UTC = 07:30 on the 26th in Kolkata, 19:00 on the 25th in Los Angeles.
    const now = new Date('2026-09-26T02:00:00Z');
    const expiry = new Date('2026-09-25T00:00:00Z'); // usable THROUGH the 25th
    strict_1.default.equal((0, timezone_context_js_1.runWithCompanyTimezone)('co-ist', () => (0, expiry_date_js_1.isExpiredOn)(expiry, now)), true, 'already the 26th in India');
    strict_1.default.equal((0, timezone_context_js_1.runWithCompanyTimezone)('co-la', () => (0, expiry_date_js_1.isExpiredOn)(expiry, now)), false, 'still the 25th in Los Angeles');
    strict_1.default.equal((0, timezone_context_js_1.runWithCompanyTimezone)('co-la', () => (0, expiry_date_js_1.daysUntilExpiryDate)(expiry, now)), 0);
});
