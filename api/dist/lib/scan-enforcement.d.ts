export type ScanDecision = {
    ok: true;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function assertBinBelongsToLocation(scannedBinCode: string, allowedBinCodes: string[]): ScanDecision;
/**
 * Putaway: the scanned barcode must be a bin at this location. When a
 * suggestion exists and override is off, scanning a different (still
 * valid) bin is a wrong-bin block, not a silent confirm.
 */
export declare function assertPutawayScan(input: {
    scannedBinCode: string;
    suggestedBinCode?: string | null;
    allowedBinCodes: string[];
    allowOverride?: boolean;
}): ScanDecision;
/**
 * Guided walk: the next unscanned bin in walking order is the only legal
 * scan. Scanning ahead or skipping is blocked so the picker cannot jump
 * the path the wave was sequenced for.
 */
export declare function assertGuidedWalkScan(input: {
    scannedBinCode: string;
    walkOrder: string[];
    scannedIndex?: number;
}): ScanDecision;
export declare function nextWalkBin(walkOrder: string[], scannedIndex?: number): string | null;
