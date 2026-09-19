import { type QcCheckResult } from './qc-inspection.js';
export type InspectionLike = {
    itemId?: string | null;
    lotId?: string | null;
    sourceLineId?: string | null;
    overallResult?: string | null;
    results?: Record<string, QcCheckResult> | null;
    createdAt?: string | Date | null;
};
export type QcVerdict = 'PASS' | 'FAIL' | null;
/** The latest inspection that applies to a receipt line: same item, and same line when both name one. Null when none was recorded. */
export declare function verdictForLine(inspections: InspectionLike[], line: {
    itemId: string;
    lineId?: string | null;
}): QcVerdict;
export type GateLine = {
    itemId: string;
    lotId: string;
    lineId?: string;
    receivedQty: number;
    damagedQty: number;
};
/**
 * Lines whose inspection failed have their good quantity moved to the damaged
 * (quarantine) bucket. Totals are unchanged, so receipt validation and the
 * "received + damaged + short = ordered" arithmetic still hold; only where the
 * goods land changes.
 */
export declare function quarantineFailedLines<T extends GateLine>(lines: T[], verdictFor: (line: T) => QcVerdict): {
    lines: T[];
    quarantined: Array<{
        itemId: string;
        lotId: string;
        quantity: number;
    }>;
};
