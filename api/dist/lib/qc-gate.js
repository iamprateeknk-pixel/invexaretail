"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verdictForLine = verdictForLine;
exports.quarantineFailedLines = quarantineFailedLines;
const qc_inspection_js_1 = require("./qc-inspection.js");
const stamp = (value) => (value ? new Date(value).getTime() : 0);
function verdictOf(inspection) {
    if (inspection.overallResult === 'PASS' || inspection.overallResult === 'FAIL')
        return inspection.overallResult;
    return inspection.results ? (0, qc_inspection_js_1.evaluateInspection)(inspection.results) : 'PASS';
}
/** The latest inspection that applies to a receipt line: same item, and same line when both name one. Null when none was recorded. */
function verdictForLine(inspections, line) {
    const matching = inspections.filter((inspection) => inspection.itemId === line.itemId
        && (!line.lineId || !inspection.sourceLineId || inspection.sourceLineId === line.lineId));
    if (!matching.length)
        return null;
    // Same timestamp (or none): the later entry in the list wins, and a failure never gets outvoted by ordering luck.
    const latest = matching.reduce((best, candidate) => (stamp(candidate.createdAt) >= stamp(best.createdAt) ? candidate : best));
    return verdictOf(latest);
}
/**
 * Lines whose inspection failed have their good quantity moved to the damaged
 * (quarantine) bucket. Totals are unchanged, so receipt validation and the
 * "received + damaged + short = ordered" arithmetic still hold; only where the
 * goods land changes.
 */
function quarantineFailedLines(lines, verdictFor) {
    const quarantined = [];
    const next = lines.map((line) => {
        if (!(line.receivedQty > 0) || verdictFor(line) !== 'FAIL')
            return line;
        quarantined.push({ itemId: line.itemId, lotId: line.lotId, quantity: line.receivedQty });
        return { ...line, receivedQty: 0, damagedQty: Math.round((line.damagedQty + line.receivedQty) * 1000) / 1000 };
    });
    return { lines: next, quarantined };
}
