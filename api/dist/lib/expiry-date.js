"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSINESS_TIMEZONE = void 0;
exports.expiryDayNumber = expiryDayNumber;
exports.todayDayNumber = todayDayNumber;
exports.daysUntilExpiryDate = daysUntilExpiryDate;
exports.isExpiredOn = isExpiredOn;
// Deliberately self-contained (no import from the count-campaign module, which
// itself depends on the expiry board): the timezone default mirrors
// DEFAULT_CAMPAIGN_TIMEZONE.
const timezone_context_js_1 = require("./timezone-context.js");
Object.defineProperty(exports, "BUSINESS_TIMEZONE", { enumerable: true, get: function () { return timezone_context_js_1.BUSINESS_TIMEZONE; } });
function localDateString(instant, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
    const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
}
// One definition of "how many days until this lot expires", used by allocation,
// the expiry board, alerts, the intelligence engine and the dashboard. Before
// this there were five copies, each using the *server's* local clock (UTC on the
// host) with different rounding, so the same lot could read 0, 1 or "expired"
// depending on which screen asked - and between midnight and 05:30 IST a lot
// expiring "today" already looked a day older than the store saw it.
//
// Rules (audit finding P0-1 / shelf-life management):
//  - An expiry is a calendar DATE. Stored values are date-only (UTC midnight),
//    so the expiry day is the value's UTC date - never shifted by the host zone.
//  - "Today" is the calendar date in the business timezone (Asia/Kolkata by
//    default, the same default the count campaigns use).
//  - A lot is usable THROUGH its expiry date: it is expired the day after.
const DAY_MS = 86_400_000;
function utcDayNumber(year, month, day) {
    return Date.UTC(year, month - 1, day) / DAY_MS;
}
/** The calendar day (as a day number) an expiry value falls on, or null if it is missing/invalid. */
function expiryDayNumber(expiry) {
    if (expiry === null || expiry === undefined || expiry === '')
        return null;
    const parsed = expiry instanceof Date ? expiry : new Date(expiry);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return utcDayNumber(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}
/** Today's calendar day (as a day number) in the business timezone. */
function todayDayNumber(now = new Date(), timezone = (0, timezone_context_js_1.currentTimezone)()) {
    const [year, month, day] = localDateString(now, timezone).split('-').map(Number);
    return utcDayNumber(year, month, day);
}
/** Whole calendar days from today to the expiry date (0 = expires today, negative = already expired); null if undated. */
function daysUntilExpiryDate(expiry, now = new Date(), timezone = (0, timezone_context_js_1.currentTimezone)()) {
    const expiryDay = expiryDayNumber(expiry);
    if (expiryDay === null)
        return null;
    return expiryDay - todayDayNumber(now, timezone);
}
/** True only when the expiry date is strictly before today. Undated lots are never "expired" (they are a data gap, flagged elsewhere). */
function isExpiredOn(expiry, now = new Date(), timezone = (0, timezone_context_js_1.currentTimezone)()) {
    const days = daysUntilExpiryDate(expiry, now, timezone);
    return days !== null && days < 0;
}
