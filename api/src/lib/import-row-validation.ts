// Week 11: per-row validation for the staged import lifecycle. Pure
// validation + resolution (reads only - no writes, no lot creation) so a
// batch can be validated, inspected and re-validated freely before commit
// ever touches stock. Every rejection carries a stable `code` (mirroring
// lib/errors.ts's DomainError codes elsewhere in the app) plus a `field`
// and a human `message` safe to show a spreadsheet operator - the guide's
// "row, field, code and safe message" failure-export requirement.
import { prisma } from './db.js';
import type { TenantContext } from './tenant-context.js';
import type { ImportType } from './import-business-rules.js';
import {
  parseImportQuantity,
  resolvePurchaseLocation,
  resolveBranchLocation,
  InvalidQuantityError,
  BranchNotFoundError,
  HoLocationNotConfiguredError,
} from './import-business-rules.js';

export type RowError = { field: string; code: string; message: string };

export type MappedPurchaseSalesRow = {
  itemCode: string;
  itemId: string;
  lotNo: string;
  quantity: number;
  locationId: string;
  transactionAt: string;
  branchName?: string;
};

export type RowValidationResult =
  | { ok: true; mapped: MappedPurchaseSalesRow; warnings: RowError[] }
  | { ok: false; errors: RowError[] };

export type RawImportRow = {
  itemCode?: unknown;
  lotNo?: unknown;
  quantity?: unknown;
  branchName?: unknown;
  transactionAt?: unknown;
};

/**
 * Resolves and validates one row for PURCHASE, SALES or SALES_RETURN.
 * Does not write anything - lot creation and the actual stock post happen
 * at commit time, atomically with each other, so a batch that is only
 * ever validated (never committed) never leaves behind lots nobody asked
 * for.
 */
export async function validateImportRow(ctx: TenantContext, type: ImportType, raw: RawImportRow): Promise<RowValidationResult> {
  const errors: RowError[] = [];
  const warnings: RowError[] = [];

  const itemCode = typeof raw.itemCode === 'string' ? raw.itemCode.trim() : '';
  if (!itemCode) errors.push({ field: 'itemCode', code: 'MISSING_ITEM_CODE', message: 'Item code is required.' });

  const lotNo = typeof raw.lotNo === 'string' ? raw.lotNo.trim() : '';
  if (!lotNo) errors.push({ field: 'lotNo', code: 'MISSING_LOT_NO', message: 'Lot number is required.' });

  let quantity: number | null = null;
  try {
    quantity = parseImportQuantity(raw.quantity);
    if (type !== 'SALES_RETURN' && quantity <= 0) {
      errors.push({ field: 'quantity', code: 'INVALID_QUANTITY', message: 'Quantity must be a positive number.' });
    }
  } catch (error) {
    if (error instanceof InvalidQuantityError) {
      errors.push({ field: 'quantity', code: 'INVALID_QUANTITY', message: `"${String(raw.quantity)}" is not a valid quantity.` });
    } else {
      throw error;
    }
  }

  let transactionAt: Date | null = null;
  if (typeof raw.transactionAt !== 'string' || !raw.transactionAt.trim()) {
    errors.push({ field: 'transactionAt', code: 'MISSING_TRANSACTION_TIME', message: 'A transaction date/time is required.' });
  } else {
    const parsed = new Date(raw.transactionAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ field: 'transactionAt', code: 'INVALID_TRANSACTION_TIME', message: `"${raw.transactionAt}" is not a valid date/time.` });
    } else {
      transactionAt = parsed;
    }
  }

  let locationId: string | null = null;
  const branchName = typeof raw.branchName === 'string' ? raw.branchName.trim() : '';
  if (type === 'PURCHASE') {
    try {
      const location = await resolvePurchaseLocation(ctx);
      locationId = location.id;
    } catch (error) {
      if (error instanceof HoLocationNotConfiguredError) {
        errors.push({ field: 'branchName', code: 'HO_LOCATION_NOT_CONFIGURED', message: error.message });
      } else {
        throw error;
      }
    }
  } else {
    if (!branchName) {
      errors.push({ field: 'branchName', code: 'MISSING_BRANCH_NAME', message: 'Branch name is required.' });
    } else {
      try {
        const location = await resolveBranchLocation(ctx, branchName);
        locationId = location.id;
      } catch (error) {
        if (error instanceof BranchNotFoundError) {
          errors.push({ field: 'branchName', code: 'BRANCH_NOT_FOUND', message: error.message });
        } else {
          throw error;
        }
      }
    }
  }

  let itemId: string | null = null;
  if (itemCode) {
    const item = await prisma.item.findFirst({ where: { code: itemCode, companyId: ctx.companyId } });
    if (!item) {
      errors.push({ field: 'itemCode', code: 'ITEM_NOT_FOUND', message: `No item with code "${itemCode}" was found.` });
    } else {
      itemId = item.id;
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    mapped: {
      itemCode,
      itemId: itemId!,
      lotNo,
      quantity: quantity!,
      locationId: locationId!,
      transactionAt: transactionAt!.toISOString(),
      branchName: branchName || undefined,
    },
    warnings,
  };
}
