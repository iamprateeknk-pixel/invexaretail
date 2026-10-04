"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const cycle_count_cadence_context_js_1 = require("./cycle-count-cadence-context.js");
(0, node_test_1.default)('a company with no override gets the 7/30/90 default', () => {
    strict_1.default.deepEqual((0, cycle_count_cadence_context_js_1.cadenceForCompany)('never-cached'), cycle_count_cadence_context_js_1.DEFAULT_CADENCE_DAYS);
    strict_1.default.deepEqual((0, cycle_count_cadence_context_js_1.cadenceForCompany)(undefined), cycle_count_cadence_context_js_1.DEFAULT_CADENCE_DAYS);
});
(0, node_test_1.default)('invalid values are rejected; out-of-range or non-integer days do not cache', () => {
    strict_1.default.equal((0, cycle_count_cadence_context_js_1.validCadenceDays)(0), null);
    strict_1.default.equal((0, cycle_count_cadence_context_js_1.validCadenceDays)(-1), null);
    strict_1.default.equal((0, cycle_count_cadence_context_js_1.validCadenceDays)(3.5), null);
    strict_1.default.equal((0, cycle_count_cadence_context_js_1.validCadenceDays)(3651), null);
    strict_1.default.equal((0, cycle_count_cadence_context_js_1.validCadenceDays)('14'), 14);
});
(0, node_test_1.default)('a full override replaces all three classes; a partial one keeps the default for the rest', () => {
    (0, cycle_count_cadence_context_js_1.cacheCompanyCadence)('co-full', { cycleCountCadenceADays: 3, cycleCountCadenceBDays: 15, cycleCountCadenceCDays: 60 });
    strict_1.default.deepEqual((0, cycle_count_cadence_context_js_1.cadenceForCompany)('co-full'), { A: 3, B: 15, C: 60 });
    (0, cycle_count_cadence_context_js_1.cacheCompanyCadence)('co-partial', { cycleCountCadenceADays: 14, cycleCountCadenceBDays: null, cycleCountCadenceCDays: null });
    strict_1.default.deepEqual((0, cycle_count_cadence_context_js_1.cadenceForCompany)('co-partial'), { A: 14, B: cycle_count_cadence_context_js_1.DEFAULT_CADENCE_DAYS.B, C: cycle_count_cadence_context_js_1.DEFAULT_CADENCE_DAYS.C });
});
(0, node_test_1.default)('caching all-null clears any previous override back to the default', () => {
    (0, cycle_count_cadence_context_js_1.cacheCompanyCadence)('co-clear', { cycleCountCadenceADays: 20, cycleCountCadenceBDays: 40, cycleCountCadenceCDays: 100 });
    strict_1.default.deepEqual((0, cycle_count_cadence_context_js_1.cadenceForCompany)('co-clear'), { A: 20, B: 40, C: 100 });
    (0, cycle_count_cadence_context_js_1.cacheCompanyCadence)('co-clear', { cycleCountCadenceADays: null, cycleCountCadenceBDays: null, cycleCountCadenceCDays: null });
    strict_1.default.deepEqual((0, cycle_count_cadence_context_js_1.cadenceForCompany)('co-clear'), cycle_count_cadence_context_js_1.DEFAULT_CADENCE_DAYS);
});
