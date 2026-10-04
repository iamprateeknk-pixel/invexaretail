"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUNT_REASON_CODES = void 0;
exports.parseCountReasonCode = parseCountReasonCode;
exports.summarizeVarianceReasons = summarizeVarianceReasons;
exports.summarizeCountAccuracyByClass = summarizeCountAccuracyByClass;
exports.summarizeCountAccuracy = summarizeCountAccuracy;
// Root-cause codes for count variances (audit C-3). Variances used to be adjusted with only a
// free-text reason, so nothing could be analysed. The set is small and fixed on purpose: a code you
// can group by beats a free-text field nobody aggregates.
exports.COUNT_REASON_CODES = ['THEFT_SHRINKAGE', 'DAMAGE', 'EXPIRY_WRITE_OFF', 'RECEIVING_ERROR', 'PICKING_ERROR', 'MISCOUNT', 'SYSTEM_TIMING', 'SUPPLIER_SHORTAGE', 'OTHER'];
/** Undefined/empty -> undefined (optional); anything else must be one of the codes. */
function parseCountReasonCode(value) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const code = String(value).trim().toUpperCase();
    if (!exports.COUNT_REASON_CODES.includes(code)) {
        throw new Error(`reasonCode must be one of: ${exports.COUNT_REASON_CODES.join(', ')}.`);
    }
    return code;
}
/** Units and count of variances per code, worst absolute impact first; uncoded variances are reported as UNCODED. */
function summarizeVarianceReasons(counts) {
    const byCode = new Map();
    for (const count of counts) {
        const variance = count.physicalQty - count.bookQty;
        if (variance === 0)
            continue;
        const key = count.reasonCode || 'UNCODED';
        const row = byCode.get(key) ?? { counts: 0, absoluteUnits: 0, netUnits: 0 };
        row.counts += 1;
        row.absoluteUnits += Math.abs(variance);
        row.netUnits += variance;
        byCode.set(key, row);
    }
    return [...byCode.entries()].map(([reasonCode, row]) => ({ reasonCode, ...row })).sort((a, b) => b.absoluteUnits - a.absoluteUnits || a.reasonCode.localeCompare(b.reasonCode));
}
/** Same summary, plus a per-ABC-class breakdown when the counts carry a class (A items matter most; a blended 95% can hide a 70% on A). */
function summarizeCountAccuracyByClass(counts, tolerance) {
    const byClass = {};
    for (const abcClass of ['A', 'B', 'C']) {
        const rows = counts.filter((count) => count.abcClass === abcClass);
        if (rows.length)
            byClass[abcClass] = summarizeCountAccuracy(rows, tolerance);
    }
    return { ...summarizeCountAccuracy(counts, tolerance), byClass };
}
function summarizeCountAccuracy(counts, tolerance) {
    let within = 0;
    let varianceValue = 0;
    let bookValue = 0;
    let costed = 0;
    for (const count of counts) {
        const diff = Math.abs(count.physicalQty - count.bookQty);
        const allowed = Math.max(tolerance.minUnits, (Math.abs(count.bookQty) * tolerance.percent) / 100);
        if (diff <= allowed)
            within += 1;
        if (count.unitCost && count.unitCost > 0) {
            costed += 1;
            varianceValue += diff * count.unitCost;
            bookValue += Math.abs(count.bookQty) * count.unitCost;
        }
    }
    const round = (value) => Math.round(value * 100) / 100;
    return {
        counts: counts.length,
        withinTolerance: within,
        accuracyPercent: counts.length ? round((within / counts.length) * 100) : null,
        costedCounts: costed,
        varianceValue: round(varianceValue),
        /** 100 - variance value as a share of the counted book value; null when nothing costed was counted. */
        valueAccuracyPercent: bookValue > 0 ? round(Math.max(0, 100 - (varianceValue / bookValue) * 100)) : null,
    };
}
