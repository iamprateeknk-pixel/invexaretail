import { type ExpiryBoard } from './expiry-board.js';
import { type LotRecord, type Role } from './repository.js';
export declare class ExpiryWriteOffError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
export declare function expiryAlertId(itemId: string, lotId: string, locationId: string): string;
export declare function assertCanWriteOffExpiry(role: Role | string): void;
export declare function parseWriteOffReason(value: unknown): string;
export declare function buildLocationExpiryBoard(locationId: string, now?: Date): ExpiryBoard;
export declare function listLocationExpiryAlerts(locationId: string, now?: Date): {
    id: string;
    itemId: string;
    lotId: string;
    locationId: string;
    quantity: number;
    expiryDate: string;
    daysUntilExpiry: number;
    status: string;
    recommendedAction: string;
    item: {
        code: string;
        name: string;
    };
    lot: {
        lotNo: string;
        status: "AVAILABLE" | "EXPIRED" | "BLOCKED" | "QUARANTINE";
    };
    severity: import("./expiry-alerts.js").ExpirySeverity;
}[];
export declare function writeOffExpiryLot(input: {
    itemId: string;
    lotId: string;
    locationId: string;
    quantity?: number;
    reason: string;
    actorId: string;
    role: Role | string;
}): {
    alertId: string;
    movementId: string;
    quantity: number;
    beforeBalance: number;
    afterBalance: number;
};
export declare function setLotExpiryDate(lotId: string, raw: unknown): LotRecord;
export declare function setLotSaleStatus(lotId: string, status: unknown): LotRecord;
