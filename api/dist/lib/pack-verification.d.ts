export type ExpectedPackLine = {
    itemId: string;
    lotId?: string | null;
    requestedQty: number;
};
export type ScannedPackLine = {
    itemId: string;
    lotId?: string | null;
    quantity: number;
};
export type PackLineStatus = 'MATCHED' | 'SHORT' | 'OVER' | 'UNEXPECTED';
export type PackLineResult = {
    itemId: string;
    lotId: string | null;
    requestedQty: number;
    scannedQty: number;
    status: PackLineStatus;
};
export type PackVerification = {
    lines: PackLineResult[];
    readyToSeal: boolean;
};
export declare function verifyPackScan(expected: ExpectedPackLine[], scanned: ScannedPackLine[]): PackVerification;
