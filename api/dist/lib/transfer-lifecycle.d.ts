import type { Role, TransferStatus } from './inventory.js';
export declare class InvalidTransferTransitionError extends Error {
    readonly from: TransferStatus;
    readonly to: TransferStatus;
    readonly role?: string;
    constructor(from: TransferStatus, to: TransferStatus, role?: string);
}
export declare function canManageTransferDispatch(role: string): boolean;
export declare function canCreateTransfer(role: string): boolean;
export declare function allowedTransferTransitions(role: Role, from: TransferStatus): TransferStatus[];
export declare function assertValidTransferTransition(role: Role, from: TransferStatus, to: TransferStatus): void;
export declare function parseCartonCount(value: unknown): number | undefined;
export declare function isReceivableStatus(status: string): boolean;
