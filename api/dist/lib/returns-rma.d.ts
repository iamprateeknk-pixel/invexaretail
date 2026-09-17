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
