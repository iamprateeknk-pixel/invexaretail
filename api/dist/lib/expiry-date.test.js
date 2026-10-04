"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const expiry_date_js_1 = require("./expiry-date.js");
// Asia/Kolkata is UTC+05:30. 2026-09-25T20:00Z is already 01:30 on 2026-09-26 in India.
const lateEveningUtc = new Date('2026-09-25T20:00:00Z');
const noonIst = new Date('2026-09-26T06:30:00Z');
(0, node_test_1.default)('today is the calendar date in the business timezone, not the host (UTC) date', () => {
    strict_1.default.equal((0, expiry_date_js_1.todayDayNumber)(lateEveningUtc), (0, expiry_date_js_1.todayDayNumber)(noonIst));
    strict_1.default.equal((0, expiry_date_js_1.todayDayNumber)(lateEveningUtc, 'UTC') + 1, (0, expiry_date_js_1.todayDayNumber)(lateEveningUtc));
});
(0, node_test_1.default)('a lot is usable through its expiry date and expired the day after', () => {
    strict_1.default.equal((0, expiry_date_js_1.daysUntilExpiryDate)('2026-09-26T00:00:00.000Z', noonIst), 0);
    strict_1.default.equal((0, expiry_date_js_1.isExpiredOn)('2026-09-26T00:00:00.000Z', noonIst), false, 'expires today = still usable today');
    strict_1.default.equal((0, expiry_date_js_1.isExpiredOn)('2026-09-25T00:00:00.000Z', noonIst), true);
    strict_1.default.equal((0, expiry_date_js_1.daysUntilExpiryDate)('2026-09-25T00:00:00.000Z', noonIst), -1);
    strict_1.default.equal((0, expiry_date_js_1.daysUntilExpiryDate)('2026-10-03T00:00:00.000Z', noonIst), 7);
});
(0, node_test_1.default)('after IST midnight the store and the server agree that yesterday\'s lot is expired', () => {
    // 01:30 IST on the 26th: a lot dated the 25th must already be expired, even though the host clock (UTC) still says the 25th.
    strict_1.default.equal((0, expiry_date_js_1.isExpiredOn)('2026-09-25T00:00:00.000Z', lateEveningUtc), true);
    strict_1.default.equal((0, expiry_date_js_1.isExpiredOn)('2026-09-26T00:00:00.000Z', lateEveningUtc), false);
});
(0, node_test_1.default)('a date-only expiry is never shifted by the host timezone; missing or invalid values are null, not expired', () => {
    strict_1.default.equal((0, expiry_date_js_1.expiryDayNumber)('2027-12-31T00:00:00.000Z'), (0, expiry_date_js_1.expiryDayNumber)(new Date(Date.UTC(2027, 11, 31))));
    strict_1.default.equal((0, expiry_date_js_1.daysUntilExpiryDate)(null), null);
    strict_1.default.equal((0, expiry_date_js_1.daysUntilExpiryDate)('not a date'), null);
    strict_1.default.equal((0, expiry_date_js_1.isExpiredOn)(undefined), false);
    strict_1.default.equal((0, expiry_date_js_1.isExpiredOn)(''), false);
});
