export type PoStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
export declare const PO_STATUSES: readonly PoStatus[];
export declare function isPoStatus(value: unknown): value is PoStatus;
export declare function allowedPoMoves(from: PoStatus): PoStatus[];
/** Goods can arrive once the order is approved - and only until it is closed or cancelled. */
export declare function isReceivablePo(status: string): boolean;
export type PoMoveCheck = {
    ok: true;
} | {
    ok: false;
    message: string;
};
export declare function checkPoMove(input: {
    from: PoStatus;
    to: PoStatus;
    anyReceived: boolean;
    invoiceStatuses: string[];
    note?: string | null;
}): PoMoveCheck;
