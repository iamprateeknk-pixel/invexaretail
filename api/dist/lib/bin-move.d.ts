export declare class BinMoveValidationError extends Error {
    constructor(message: string);
}
export type BinMoveScanInput = {
    scannedFromBinCode: string;
    scannedToBinCode: string;
    allowedBinCodes: string[];
    quantity: number;
};
export declare function assertValidBinMove(input: BinMoveScanInput): void;
