"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CADENCE_DAYS = void 0;
exports.validCadenceDays = validCadenceDays;
exports.cacheCompanyCadence = cacheCompanyCadence;
exports.cadenceForCompany = cadenceForCompany;
/** Defaults when a company has no override: weekly/monthly/quarterly (ABC_CADENCE). */
exports.DEFAULT_CADENCE_DAYS = { A: 7, B: 30, C: 90 };
function validCadenceDays(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null;
}
const byCompany = new Map();
/** Cache write (used by the loader and by the settings route after a save). An entry with no valid days is cleared. */
function cacheCompanyCadence(companyId, cadence) {
    const a = validCadenceDays(cadence?.cycleCountCadenceADays);
    const b = validCadenceDays(cadence?.cycleCountCadenceBDays);
    const c = validCadenceDays(cadence?.cycleCountCadenceCDays);
    if (a === null && b === null && c === null) {
        byCompany.delete(companyId);
        return;
    }
    byCompany.set(companyId, { A: a ?? exports.DEFAULT_CADENCE_DAYS.A, B: b ?? exports.DEFAULT_CADENCE_DAYS.B, C: c ?? exports.DEFAULT_CADENCE_DAYS.C });
}
function cadenceForCompany(companyId) {
    return (companyId ? byCompany.get(companyId) : undefined) ?? exports.DEFAULT_CADENCE_DAYS;
}
