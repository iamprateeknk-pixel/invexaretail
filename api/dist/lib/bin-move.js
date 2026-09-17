"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinMoveValidationError = void 0;
exports.assertValidBinMove = assertValidBinMove;
const scan_enforcement_js_1 = require("./scan-enforcement.js");
// Blueprint P4 "WMS 3.0: Bin moves": a bin-to-bin transfer must be an
// explicit scanned action - source bin scan -> item scan (caller resolves
// itemId before this) -> lot/serial -> quantity -> destination bin scan -
// not a silent balance edit. This module only decides whether the scanned
// move is legal; the caller persists the BinStock delta + BinMovement row.
class BinMoveValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BinMoveValidationError';
    }
}
exports.BinMoveValidationError = BinMoveValidationError;
function assertValidBinMove(input) {
    if (!(input.quantity > 0)) {
        throw new BinMoveValidationError('Quantity must be greater than zero.');
    }
    if (input.scannedFromBinCode.trim().toUpperCase() === input.scannedToBinCode.trim().toUpperCase()) {
        throw new BinMoveValidationError('Source and destination bin must be different.');
    }
    const fromScan = (0, scan_enforcement_js_1.assertBinBelongsToLocation)(input.scannedFromBinCode, input.allowedBinCodes);
    if (fromScan.ok === false)
        throw new BinMoveValidationError(fromScan.message);
    const toScan = (0, scan_enforcement_js_1.assertBinBelongsToLocation)(input.scannedToBinCode, input.allowedBinCodes);
    if (toScan.ok === false)
        throw new BinMoveValidationError(toScan.message);
}
