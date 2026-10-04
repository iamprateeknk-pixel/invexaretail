"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const report_range_js_1 = require("./report-range.js");
(0, node_test_1.default)('date-only bounds are whole calendar days in the report timezone (Asia/Kolkata, +05:30)', () => {
    const range = (0, report_range_js_1.resolveReportRange)({ from: '2026-09-25', to: '2026-09-25' });
    strict_1.default.equal(range.timezone, 'Asia/Kolkata');
    strict_1.default.equal(range.from, '2026-09-24T18:30:00.000Z');
    strict_1.default.equal(range.to, '2026-09-25T18:29:59.000Z');
});
(0, node_test_1.default)('the same day resolves differently in another timezone, and UTC is explicit', () => {
    const utc = (0, report_range_js_1.resolveReportRange)({ from: '2026-09-25', to: '2026-09-25', timezone: 'UTC' });
    strict_1.default.equal(utc.from, '2026-09-25T00:00:00.000Z');
    strict_1.default.equal(utc.to, '2026-09-25T23:59:59.000Z');
    const ny = (0, report_range_js_1.resolveReportRange)({ from: '2026-09-25', timezone: 'America/New_York' });
    strict_1.default.equal(ny.from, '2026-09-25T04:00:00.000Z');
});
(0, node_test_1.default)('an instant late on the last day is inside an inclusive `to` (the old string comparison dropped it)', () => {
    const { to } = (0, report_range_js_1.resolveReportRange)({ to: '2026-09-25' });
    strict_1.default.ok('2026-09-25T10:00:00.000Z' <= to);
    strict_1.default.ok('2026-09-25T18:30:00.000Z' > to, 'first instant of the next local day is outside');
});
(0, node_test_1.default)('ISO timestamps pass through normalised; missing bounds stay open', () => {
    strict_1.default.deepEqual((0, report_range_js_1.resolveReportRange)({ from: '2026-09-25T10:00:00+05:30' }), { timezone: 'Asia/Kolkata', from: '2026-09-25T04:30:00.000Z', to: undefined });
    strict_1.default.deepEqual((0, report_range_js_1.resolveReportRange)({}), { timezone: 'Asia/Kolkata', from: undefined, to: undefined });
});
(0, node_test_1.default)('bad input is a clear error, not a silently empty report', () => {
    strict_1.default.throws(() => (0, report_range_js_1.resolveReportRange)({ from: 'yesterday' }), report_range_js_1.ReportRangeError);
    strict_1.default.throws(() => (0, report_range_js_1.resolveReportRange)({ timezone: 'Mars/Base' }), /Unknown timezone/);
    strict_1.default.throws(() => (0, report_range_js_1.resolveReportRange)({ from: '2026-09-26', to: '2026-09-25' }), /from must not be after to/);
    strict_1.default.throws(() => (0, report_range_js_1.resolveReportRange)({ from: 5 }), report_range_js_1.ReportRangeError);
});
