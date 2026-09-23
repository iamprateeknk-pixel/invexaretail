import { type TransferInput, type AccessContext } from './inventory.js';
import { type TransferRequest } from './store.js';
import { InsufficientStockError } from './reservation.js';
export declare class TransferRoleError extends Error {
}
export declare class TransferValidationError extends Error {
}
export declare class TransferExpiryBlockedError extends Error {
}
export type CreateTransferCommand = {
    context: AccessContext;
    input: TransferInput;
    actorId: string;
    actorRole: string;
    companyId: string;
    requestId?: string;
    traceId?: string;
};
/**
 * Creates a transfer request: validates the payload, blocks expired/
 * quarantined lots when the active workflow requires it, reserves stock
 * (Week 7's atomic reservation primitive) before the transfer row exists so
 * a second concurrent request against the same low-stock lot is rejected
 * here rather than discovering the shortfall later, and releases the
 * reservation if persisting the transfer itself then fails - unchanged
 * behavior from the version of this logic that lived inline in
 * routes/core.ts's `POST /transfers` handler before this week's extraction.
 */
export declare function createTransfer(cmd: CreateTransferCommand): Promise<TransferRequest>;
export { InsufficientStockError };
