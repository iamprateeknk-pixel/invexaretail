"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportRangeError = void 0;
exports.resolveReportRange = resolveReportRange;
const timezone_context_js_1 = require("./timezone-context.js");
const stock_take_campaign_js_1 = require("./stock-take-campaign.js");
class ReportRangeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ReportRangeError';
    }
}
exports.ReportRangeError = ReportRangeError;
function resolveBound(value, edge, timezone) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string')
        throw new ReportRangeError(`${edge} must be a date (YYYY-MM-DD) or an ISO timestamp.`);
    if ((0, stock_take_campaign_js_1.isDateOnly)(value))
        return edge === 'from' ? (0, stock_take_campaign_js_1.startOfLocalDayIso)(value, timezone) : (0, stock_take_campaign_js_1.endOfLocalDayIso)(value, timezone);
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
        throw new ReportRangeError(`${edge} must be a date (YYYY-MM-DD) or an ISO timestamp.`);
    return new Date(parsed).toISOString();
}
function resolveReportRange(input) {
    const timezone = input.timezone === undefined || input.timezone === '' ? (0, timezone_context_js_1.currentTimezone)() : String(input.timezone);
    if (!(0, stock_take_campaign_js_1.isValidTimezone)(timezone))
        throw new ReportRangeError(`Unknown timezone "${timezone}". Use an IANA name such as Asia/Kolkata.`);
    const from = resolveBound(input.from, 'from', timezone);
    const to = resolveBound(input.to, 'to', timezone);
    if (from && to && from > to)
        throw new ReportRangeError('from must not be after to.');
    return { timezone, from, to };
}
