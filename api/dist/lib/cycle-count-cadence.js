"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCompanyCycleCountCadences = loadCompanyCycleCountCadences;
exports.saveCompanyCycleCountCadence = saveCompanyCycleCountCadence;
const db_js_1 = require("./db.js");
const cycle_count_cadence_context_js_1 = require("./cycle-count-cadence-context.js");
/** Loads every company's configured cadence into the in-process cache (boot, and after a change). */
async function loadCompanyCycleCountCadences() {
    const rows = await db_js_1.prisma.companyProfile.findMany({
        select: { id: true, cycleCountCadenceADays: true, cycleCountCadenceBDays: true, cycleCountCadenceCDays: true },
    });
    for (const row of rows)
        (0, cycle_count_cadence_context_js_1.cacheCompanyCadence)(row.id, row);
    return rows.length;
}
async function saveCompanyCycleCountCadence(companyId, days) {
    const data = {};
    for (const [cls, field] of [['A', 'cycleCountCadenceADays'], ['B', 'cycleCountCadenceBDays'], ['C', 'cycleCountCadenceCDays']]) {
        if (!(cls in days))
            continue;
        const requested = days[cls];
        if (requested === null) {
            data[field] = null;
            continue;
        }
        const valid = (0, cycle_count_cadence_context_js_1.validCadenceDays)(requested);
        if (valid === null)
            throw new RangeError(`${cls} cadence must be a whole number of days between 1 and 3650.`);
        data[field] = valid;
    }
    const updated = await db_js_1.prisma.companyProfile.update({ where: { id: companyId }, data });
    (0, cycle_count_cadence_context_js_1.cacheCompanyCadence)(companyId, updated);
    return (0, cycle_count_cadence_context_js_1.cadenceForCompany)(companyId);
}
