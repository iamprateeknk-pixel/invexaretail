export type ReturnLineInput = {
    orderLineId: string;
    quantity: number;
    fulfilledQty: number;
    alreadyReturnedQty: number;
};
export type ReturnLineValidation = {
    ok: boolean;
    errors: string[];
};
export declare function validateReturnLines(lines: ReturnLineInput[]): ReturnLineValidation;
export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'CLOSED';
export type ReturnAction = 'APPROVE' | 'REJECT' | 'RECEIVE' | 'CLOSE';
export declare function nextReturnStatus(current: ReturnStatus, action: ReturnAction): ReturnStatus | null;
export type ReturnLineDisposition = 'RESTOCK' | 'SCRAP' | 'RETURN_TO_VENDOR';
export declare function isRestockDisposition(disposition: string): disposition is 'RESTOCK';
export declare const PENDING_INSPECTION = "PENDING_INSPECTION";
export declare const QC_FAILED = "QC_FAILED";
export type ReturnLinePlan = {
    ok: true;
    action: 'RESTOCK' | 'HOLD' | 'SCRAP' | 'VENDOR';
    disposition: string;
    note?: string;
} | {
    ok: false;
    message: string;
};
/** What to do with one returned line. `requested` empty means "decide later" - the goods are held, never restocked by default. */
export declare function planReturnLine(input: {
    requested?: string | null;
    qcRequired: boolean;
    verdict: 'PASS' | 'FAIL' | null;
}): ReturnLinePlan;
export declare function isPendingDisposition(disposition: string | null | undefined): boolean;
/** A return can only be closed once nothing is still waiting for a disposition. */
export declare function canCloseReturn(lines: Array<{
    disposition?: string | null;
}>): {
    ok: true;
} | {
    ok: false;
    message: string;
};
export type RefundStatus = 'PENDING' | 'REFUNDED' | 'DENIED';
export declare function parseRefundDecision(value: unknown): 'REFUNDED' | 'DENIED' | null;
