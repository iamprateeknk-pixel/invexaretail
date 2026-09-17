"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiptLineRequiresQc = receiptLineRequiresQc;
exports.assertReceiptQcComplete = assertReceiptQcComplete;
const qc_inspection_js_1 = require("./qc-inspection.js");
function receiptLineRequiresQc(line, templates) {
    if (!(line.receivedQty > 0))
        return false;
    return (0, qc_inspection_js_1.findTemplateForCategory)(templates, line.itemCategory ?? null) !== null;
}
function assertReceiptQcComplete(lines, templates) {
    for (const line of lines) {
        if (!receiptLineRequiresQc(line, templates))
            continue;
        if (!line.hasInspection) {
            return {
                ok: false,
                itemId: line.itemId,
                lineId: line.lineId,
                message: `QC checklist is required before receiving ${line.itemId}. Record an inspection, then post the receipt.`,
            };
        }
    }
    return { ok: true };
}
