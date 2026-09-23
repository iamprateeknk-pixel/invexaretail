// Week 11: the approved Invexa business rules for purchase/sales imports,
// as one place instead of scattered inline checks:
//   - Purchases post at Head Office (Basni), never at the branch named in
//     the row.
//   - Sales route by the row's Branch Name + bill time.
//   - Sales returns add stock back to the branch named in the row.
//   - Item names may repeat across catalog entries; lot identity
//     (itemId + lotNo) is the real uniqueness boundary (already a DB
//     unique constraint - Lot's @@unique([itemId, lotNo])).
//   - A row whose transaction time is before the location's sync
//     checkpoint is "late" - flagged, still posted (financial data is
//     never silently dropped), and the checkpoint itself is only ever
//     advanced forward, never regressed by a late row.
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';

export const HO_LOCATION_NAME = 'HO Basni';

export type ImportType = 'PURCHASE' | 'SALES' | 'SALES_RETURN' | 'OPENING_STOCK';

// Guide: "Choose and document all-or-nothing or partial-success semantics
// per import type." Purchases/sales/returns are row-independent (one bad
// row does not implicate any other row's correctness), so a valid row
// should not be held hostage by an invalid sibling - PARTIAL_SUCCESS.
// Opening stock is the one exception: it establishes the *starting* truth
// for every item/lot/location in the file, and a partially-applied opening
// balance is worse than none (some items would silently start from zero
// instead of their real count) - ALL_OR_NOTHING.
export const IMPORT_TYPE_POLICY: Record<ImportType, 'ALL_OR_NOTHING' | 'PARTIAL_SUCCESS'> = {
  PURCHASE: 'PARTIAL_SUCCESS',
  SALES: 'PARTIAL_SUCCESS',
  SALES_RETURN: 'PARTIAL_SUCCESS',
  OPENING_STOCK: 'ALL_OR_NOTHING',
};

export class HoLocationNotConfiguredError extends Error {
  constructor(companyId: string) {
    super(`No location named "${HO_LOCATION_NAME}" is configured for company ${companyId}. Purchases cannot be posted until Head Office is set up.`);
    this.name = 'HoLocationNotConfiguredError';
  }
}

export class BranchNotFoundError extends Error {
  constructor(branchName: string) {
    super(`No location named "${branchName}" was found.`);
    this.name = 'BranchNotFoundError';
  }
}

export class InvalidQuantityError extends Error {
  constructor(raw: unknown) {
    super(`"${String(raw)}" is not a valid quantity.`);
    this.name = 'InvalidQuantityError';
  }
}

/** Purchases always land at Head Office, regardless of what branch the row names - resolved once per batch, not per row, since it never varies within a company. */
export async function resolvePurchaseLocation(ctx: TenantContext) {
  const location = await prisma.location.findFirst({ where: { companyId: ctx.companyId, name: HO_LOCATION_NAME } });
  if (!location) throw new HoLocationNotConfiguredError(ctx.companyId);
  return location;
}

/** Sales and sales returns route by the row's own Branch Name field. */
export async function resolveBranchLocation(ctx: TenantContext, branchName: string) {
  const trimmed = branchName?.trim();
  if (!trimmed) throw new BranchNotFoundError(branchName ?? '');
  const location = await prisma.location.findFirst({
    where: { companyId: ctx.companyId, name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (!location) throw new BranchNotFoundError(trimmed);
  return location;
}

/**
 * Strict numeric parsing - rejects anything that isn't a finite, real
 * quantity (blank, text, Infinity, NaN) rather than coercing it to 0 and
 * silently posting a zero-quantity movement. `Float` remains the schema
 * type for quantity (ADR-004's Decimal migration is prepared, per
 * docs/decimal-migration-plan.md, but not executed) - this is strict
 * validation of that Float, not a true arbitrary-precision Decimal parse.
 */
export function parseImportQuantity(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/,/g, '');
    if (trimmed === '') throw new InvalidQuantityError(raw);
    const value = Number(trimmed);
    if (!Number.isFinite(value)) throw new InvalidQuantityError(raw);
    return value;
  }
  throw new InvalidQuantityError(raw);
}

/**
 * Finds or creates the lot for this item, relying on Lot's own
 * `@@unique([itemId, lotNo])` constraint to make two concurrent imports
 * racing to create "the same" lot resolve to one row, not two - a
 * duplicate-key error on create is caught and re-read as the winner.
 */
export async function resolveLotForItem(itemId: string, lotNo: string, expiryDate?: Date | null) {
  const trimmedLotNo = lotNo?.trim();
  if (!trimmedLotNo) throw new Error('A lot number is required.');
  const existing = await prisma.lot.findUnique({ where: { itemId_lotNo: { itemId, lotNo: trimmedLotNo } } });
  if (existing) return existing;
  try {
    return await prisma.lot.create({ data: { itemId, lotNo: trimmedLotNo, expiryDate: expiryDate ?? undefined } });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
      const winner = await prisma.lot.findUnique({ where: { itemId_lotNo: { itemId, lotNo: trimmedLotNo } } });
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * A row is "late" if its transaction time is before this location's
 * recorded sync checkpoint for this source type - meaning data for a
 * period already considered settled just arrived. Policy: still post it
 * (never silently drop real stock movement), just flag it - callers mark
 * the row's warnings with `LATE_MOVEMENT` and must never use a late row's
 * transactionAt to move the checkpoint backwards (see
 * `advanceSyncCheckpoint`).
 */
export async function isLateMovement(locationId: string, sourceType: string, transactionAt: Date): Promise<boolean> {
  const checkpoint = await prisma.syncCheckpoint.findUnique({ where: { locationId_sourceType: { locationId, sourceType } } });
  return Boolean(checkpoint && checkpoint.syncedThroughAt > transactionAt);
}

/** Advances a location's sync checkpoint forward only - a late row committed after the checkpoint already passed it must never pull the checkpoint backward. */
export async function advanceSyncCheckpoint(locationId: string, sourceType: string, throughAt: Date, importBatchId: string): Promise<void> {
  const existing = await prisma.syncCheckpoint.findUnique({ where: { locationId_sourceType: { locationId, sourceType } } });
  if (existing && existing.syncedThroughAt >= throughAt) return;
  await prisma.syncCheckpoint.upsert({
    where: { locationId_sourceType: { locationId, sourceType } },
    update: { syncedThroughAt: throughAt, lastImportBatchId: importBatchId },
    create: { locationId, sourceType, syncedThroughAt: throughAt, lastImportBatchId: importBatchId },
  });
}
