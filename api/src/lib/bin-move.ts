import { assertBinBelongsToLocation } from './scan-enforcement.js';

// Blueprint P4 "WMS 3.0: Bin moves": a bin-to-bin transfer must be an
// explicit scanned action - source bin scan -> item scan (caller resolves
// itemId before this) -> lot/serial -> quantity -> destination bin scan -
// not a silent balance edit. This module only decides whether the scanned
// move is legal; the caller persists the BinStock delta + BinMovement row.

export class BinMoveValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinMoveValidationError';
  }
}

export type BinMoveScanInput = {
  scannedFromBinCode: string;
  scannedToBinCode: string;
  allowedBinCodes: string[];
  quantity: number;
};

export function assertValidBinMove(input: BinMoveScanInput): void {
  if (!(input.quantity > 0)) {
    throw new BinMoveValidationError('Quantity must be greater than zero.');
  }
  if (input.scannedFromBinCode.trim().toUpperCase() === input.scannedToBinCode.trim().toUpperCase()) {
    throw new BinMoveValidationError('Source and destination bin must be different.');
  }
  const fromScan = assertBinBelongsToLocation(input.scannedFromBinCode, input.allowedBinCodes);
  if (fromScan.ok === false) throw new BinMoveValidationError(fromScan.message);
  const toScan = assertBinBelongsToLocation(input.scannedToBinCode, input.allowedBinCodes);
  if (toScan.ok === false) throw new BinMoveValidationError(toScan.message);
}
