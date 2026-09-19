import { type ExpectedPackLine, type PackVerification } from './pack-verification.js';
export type CartonLine = {
    itemId: string;
    lotId: string;
    quantity: number;
};
export type TransferCartonRecord = {
    id: string;
    transferId: string;
    cartonNumber: string;
    packageId: string;
    lines: CartonLine[];
    quantity: number;
    weightKg?: number;
    status: 'SEALED' | 'VOID';
    packedById: string;
    sealedAt: string;
    requestId?: string;
};
export type PackMismatch = {
    itemId: string;
    lotId: string;
    kind: 'UNEXPECTED' | 'OVER';
    quantity: number;
    remaining: number;
};
/** Sealed cartons only: a voided carton no longer counts as packed. */
export declare function activeCartons(cartons: TransferCartonRecord[]): TransferCartonRecord[];
export declare function packedTotals(cartons: TransferCartonRecord[]): Map<string, number>;
export declare function remainingToPack(expected: ExpectedPackLine[], cartons: TransferCartonRecord[]): Map<string, number>;
/** What is wrong with a carton about to be sealed. Empty means it can be sealed. */
export declare function checkCartonLines(expected: ExpectedPackLine[], cartons: TransferCartonRecord[], lines: CartonLine[]): PackMismatch[];
export declare function verifyTransferPacking(expected: ExpectedPackLine[], cartons: TransferCartonRecord[]): PackVerification;
export declare function nextCartonNumber(cartons: TransferCartonRecord[]): number;
export declare function packageIdFor(transferId: string, cartonNumber: number): string;
/** Transit tracking (blueprint §17): past its promised arrival and still not received. */
export declare function isTransitDelayed(input: {
    status: string;
    expectedArrivalAt?: string;
    now?: Date;
}): boolean;
export type DispatchDetails = {
    carrier?: string;
    awb?: string;
    vehicleNo?: string;
    expectedArrivalAt?: string;
};
/** Blueprint §17 Dispatch: vehicle, courier or AWB is required, plus an optional promised arrival. */
export declare function parseDispatchDetails(body: Record<string, unknown>, now?: Date): DispatchDetails;
