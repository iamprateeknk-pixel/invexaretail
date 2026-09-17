import { type QcTemplateLike } from './qc-inspection.js';
export type ReceiptQcLine = {
    lineId?: string;
    itemId: string;
    itemCategory?: string | null;
    receivedQty: number;
    hasInspection: boolean;
};
export declare function receiptLineRequiresQc(line: ReceiptQcLine, templates: QcTemplateLike[]): boolean;
export declare function assertReceiptQcComplete(lines: ReceiptQcLine[], templates: QcTemplateLike[]): {
    ok: true;
} | {
    ok: false;
    message: string;
    lineId?: string;
    itemId: string;
};
