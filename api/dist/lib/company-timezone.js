"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCompanyTimezones = loadCompanyTimezones;
exports.saveCompanyTimezone = saveCompanyTimezone;
const db_js_1 = require("./db.js");
const timezone_context_js_1 = require("./timezone-context.js");
/** Loads every company's configured zone into the in-process cache (boot, and after a change). */
async function loadCompanyTimezones() {
    const rows = await db_js_1.prisma.companyProfile.findMany({ select: { id: true, timezone: true } });
    for (const row of rows)
        (0, timezone_context_js_1.cacheCompanyTimezone)(row.id, row.timezone);
    return rows.length;
}
async function saveCompanyTimezone(companyId, timezone) {
    const valid = timezone === null ? null : (0, timezone_context_js_1.validTimezone)(timezone);
    if (timezone !== null && !valid)
        throw new RangeError('Unknown timezone. Use an IANA name such as Asia/Kolkata.');
    await db_js_1.prisma.companyProfile.update({ where: { id: companyId }, data: { timezone: valid } });
    (0, timezone_context_js_1.cacheCompanyTimezone)(companyId, valid);
    return valid;
}
