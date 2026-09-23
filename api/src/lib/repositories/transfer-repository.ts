// Week 8: the first Transfer repository, extracted alongside routes/transfers.ts
// as the "starting with Inventory and Transfers" slice of the god-router
// split. Every exported function requires an `AccessContext` as its first
// argument - mirroring ADR-002's "the type signature must require it"
// discipline for `lib/repositories/item-repository.ts` - even though the
// underlying enforcement here is location-based (`canAccessLocation`), not
// a `companyId` column filter.
//
// Honest scope note: Transfer's read model (`lib/repository.ts`'s in-memory
// `transfers` array, hydrated from Postgres at boot) has no `companyId`
// column filter at all - the same "large pre-existing baseline" gap
// AGENTS.md already documents for the 16 unscoped `prisma.item.*` call
// sites, just for a different model. This repository does not close that
// gap (retrofitting column-level tenant scoping onto every transfer read
// path is a larger, separate migration); what it does is make the
// *existing* enforcement mechanism (per-location access, already how every
// caller in core.ts checked this) a structural requirement of the function
// signature instead of something each route handler had to remember to
// call correctly. See docs/route-ownership-matrix.md.
import type { AccessContext } from '../inventory.js';
import { canAccessLocation } from '../inventory.js';
import { listTransfers as listAllTransfers, createTransferRecord, type TransferRecord } from '../repository.js';
import { activeCartons, isTransitDelayed } from '../transfer-packing.js';
import { listTransferCartons } from '../repository.js';

export type TransferListItem = TransferRecord & {
  cartons: Array<{ packageId: string; quantity: number; weightKg?: number }>;
  delayed: boolean;
};

/** Every transfer whose source or destination the caller's access context can see. */
export function listTransfersForContext(ctx: AccessContext): TransferListItem[] {
  return listAllTransfers()
    .filter((transfer) => canAccessLocation(ctx, transfer.sourceLocationId) || canAccessLocation(ctx, transfer.destinationLocationId))
    .map((transfer) => ({
      ...transfer,
      cartons: activeCartons(listTransferCartons(transfer.id)).map((carton) => ({
        packageId: carton.packageId,
        quantity: carton.quantity,
        weightKg: carton.weightKg,
      })),
      delayed: isTransitDelayed({ status: transfer.status, expectedArrivalAt: transfer.dispatch?.expectedArrivalAt }),
    }));
}

export { createTransferRecord };
