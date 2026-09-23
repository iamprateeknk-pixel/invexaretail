import type { AccessContext } from '../inventory.js';
import { createTransferRecord, type TransferRecord } from '../repository.js';
export type TransferListItem = TransferRecord & {
    cartons: Array<{
        packageId: string;
        quantity: number;
        weightKg?: number;
    }>;
    delayed: boolean;
};
/** Every transfer whose source or destination the caller's access context can see. */
export declare function listTransfersForContext(ctx: AccessContext): TransferListItem[];
export { createTransferRecord };
