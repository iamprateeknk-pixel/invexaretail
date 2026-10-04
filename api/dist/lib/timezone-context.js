"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUSINESS_TIMEZONE = void 0;
exports.validTimezone = validTimezone;
exports.cacheCompanyTimezone = cacheCompanyTimezone;
exports.companyTimezone = companyTimezone;
exports.currentTimezone = currentTimezone;
exports.runWithCompanyTimezone = runWithCompanyTimezone;
// Per-company business timezone (audit T-2). "Today" for expiry, dashboards and reports must be the
// company's calendar day, not one hard-coded zone. Threading a timezone argument through every
// caller was the alternative; instead the authenticated request runs inside an AsyncLocalStorage
// scope carrying its company's zone, and the shared day maths default to it. Pure: no database here.
const node_async_hooks_1 = require("node:async_hooks");
function validTimezone(value) {
    if (!value)
        return null;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return value;
    }
    catch {
        return null;
    }
}
/** Process-wide default: BUSINESS_TIMEZONE (IANA name) when set and valid, else Asia/Kolkata. */
exports.BUSINESS_TIMEZONE = validTimezone(process.env.BUSINESS_TIMEZONE) ?? 'Asia/Kolkata';
const scope = new node_async_hooks_1.AsyncLocalStorage();
const byCompany = new Map();
/** Cache write (used by the loader and by the settings route after a save). Invalid zones clear the entry. */
function cacheCompanyTimezone(companyId, timezone) {
    const valid = validTimezone(timezone);
    if (valid)
        byCompany.set(companyId, valid);
    else
        byCompany.delete(companyId);
}
function companyTimezone(companyId) {
    return (companyId ? byCompany.get(companyId) : undefined) ?? exports.BUSINESS_TIMEZONE;
}
/** The zone of the request being served, else the process default. */
function currentTimezone() {
    return scope.getStore() ?? exports.BUSINESS_TIMEZONE;
}
function runWithCompanyTimezone(companyId, fn) {
    return scope.run(companyTimezone(companyId), fn);
}
