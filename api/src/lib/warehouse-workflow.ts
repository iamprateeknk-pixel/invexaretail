import { readTabularFile } from './stock-import.js';
import { isExpiredOn } from './expiry-date.js';

export type TransferImportRow = {
  rowNumber: number;
  destinationStore?: string;
  itemCode?: string;
  itemName?: string;
  requestedQty: number;
  unit?: string;
  remarks?: string;
};

export type TransferImportPreview = {
  sheetName: string;
  headerRow: number;
  totalRows: number;
  validRows: TransferImportRow[];
  errors: Array<{ rowNumber: number; message: string }>;
  duplicateRows: number;
  mapping: Record<string, string>;
};

const TRANSFER_HEADERS: Record<string, string[]> = {
  destinationStore: ['destinationstore', 'destination', 'store', 'branchname', 'location'],
  itemCode: ['itemcode', 'code', 'sku', 'barcode'],
  itemName: ['itemname', 'name', 'productname'],
  requestedQty: ['requestedqty', 'quantity', 'qty', 'transferqty'],
  unit: ['unit', 'packsize', 'pack'],
  remarks: ['remarks', 'remark', 'notes', 'note'],
};

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const valueText = (value: unknown) => String(value ?? '').trim();

export async function parseTransferImport(buffer: Buffer, fileName: string): Promise<TransferImportPreview> {
  const { sheetName, rows } = await readTabularFile(buffer, fileName);
  let headerIndex = -1;
  let columns: Record<string, number> = {};
  let mapping: Record<string, string> = {};
  for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
    const normalized = rows[index].map(normalize);
    const found: Record<string, number> = {};
    const names: Record<string, string> = {};
    for (const [field, aliases] of Object.entries(TRANSFER_HEADERS)) {
      const position = normalized.findIndex((header) => aliases.includes(header));
      if (position >= 0) { found[field] = position; names[field] = valueText(rows[index][position]); }
    }
    if (found.requestedQty !== undefined && (found.itemCode !== undefined || found.itemName !== undefined)) {
      headerIndex = index; columns = found; mapping = names; break;
    }
  }
  if (headerIndex < 0) throw new Error('Transfer header not found. Item Code or Item Name and Requested Qty are required.');

  const validRows: TransferImportRow[] = [];
  const errors: TransferImportPreview['errors'] = [];
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const source = rows[index];
    if (!source.some((cell) => valueText(cell))) continue;
    const get = (field: string) => source[columns[field]];
    const itemCode = valueText(get('itemCode')) || undefined;
    const itemName = valueText(get('itemName')) || undefined;
    const requestedQty = Number(valueText(get('requestedQty')).replaceAll(',', ''));
    const rowNumber = index + 1;
    if (!itemCode && !itemName) { errors.push({ rowNumber, message: 'Item Code or Item Name is required.' }); continue; }
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) { errors.push({ rowNumber, message: 'Requested Qty must be greater than zero.' }); continue; }
    const key = (itemCode || itemName || '').toLowerCase();
    if (seen.has(key)) duplicateRows += 1;
    seen.add(key);
    validRows.push({
      rowNumber,
      destinationStore: valueText(get('destinationStore')) || undefined,
      itemCode,
      itemName,
      requestedQty,
      unit: valueText(get('unit')) || undefined,
      remarks: valueText(get('remarks')) || undefined,
    });
  }
  return { sheetName, headerRow: headerIndex + 1, totalRows: validRows.length + errors.length, validRows, errors, duplicateRows, mapping };
}

// Section 17: expired/blocked/quarantine lots are first-class states, not
// just data. status is optional so existing callers that never set it (all
// of them before this) keep treating every lot as available, unchanged.
export type LotStatus = 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE';
export type FefoLot = { lotId: string; lotNo: string; expiryDate?: string | null; available: number; createdAt?: string; status?: LotStatus };

// A lot is allocatable only if it has stock, its status is AVAILABLE *and its
// expiry date has not passed*. Status alone was not enough: nothing sweeps lots
// to EXPIRED when their date passes, and FEFO sorts the earliest expiry first -
// so a lapsed lot still marked AVAILABLE was the FIRST one handed to orders,
// jobs and transfers. Shipping expired stock is a food-safety/compliance issue
// (audit finding P0-1). Lots that need to move anyway (e.g. to disposal) go
// through the explicit MANUAL override, which is reasoned and audited.
function effectiveStatus(lot: FefoLot, today: Date): LotStatus {
  const status = lot.status ?? 'AVAILABLE';
  return status === 'AVAILABLE' && isExpiredOn(lot.expiryDate, today) ? 'EXPIRED' : status;
}

function isAllocatable(lot: FefoLot, today: Date = new Date()): boolean {
  return lot.available > 0 && effectiveStatus(lot, today) === 'AVAILABLE';
}

export function allocateFefo(lots: FefoLot[], requestedQty: number, today: Date = new Date()): { allocations: Array<FefoLot & { quantity: number }>; shortage: number } {
  let remaining = requestedQty;
  const sorted = lots.filter((lot) => isAllocatable(lot, today)).sort((a, b) => {
    const aTime = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
  const allocations = [];
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, lot.available);
    allocations.push({ ...lot, quantity });
    remaining -= quantity;
  }
  return { allocations, shortage: Math.max(0, remaining) };
}

export type AllocationStrategy = 'FEFO' | 'FIFO' | 'MANUAL';
export type ManualAllocationLine = { lotId: string; quantity: number };
export type LotAllocationResult = { allocations: Array<FefoLot & { quantity: number }>; shortage: number; strategy: AllocationStrategy };

export class ManualAllocationRequiresReasonError extends Error {
  constructor() {
    super('A manual lot allocation override requires a reason.');
    this.name = 'ManualAllocationRequiresReasonError';
  }
}

export class LotNotAllocatableError extends Error {
  constructor(public readonly lotId: string, public readonly status: LotStatus) {
    super(`Lot ${lotId} cannot be allocated: status is ${status}.`);
    this.name = 'LotNotAllocatableError';
  }
}

export class ManualAllocationExceedsAvailableError extends Error {
  constructor(public readonly lotId: string, public readonly requested: number, public readonly available: number) {
    super(`Manual allocation of ${requested} from lot ${lotId} exceeds ${available} available.`);
    this.name = 'ManualAllocationExceedsAvailableError';
  }
}

/**
 * Configurable allocation by category/SKU (blueprint 17): FEFO (default for
 * expiry-controlled inventory), FIFO (oldest lot first by createdAt), or an
 * authorized MANUAL override. A manual override still validates each line
 * against actual availability and against the lot's status — an authorized
 * override can choose which available lots to draw from, but it cannot pull
 * stock that doesn't exist or pull from a blocked/expired/quarantined lot.
 */
export function allocateLots(
  lots: FefoLot[],
  requestedQty: number,
  strategy: AllocationStrategy,
  options?: { manualLines?: ManualAllocationLine[]; overrideReason?: string; today?: Date },
): LotAllocationResult {
  const today = options?.today ?? new Date();
  if (strategy === 'MANUAL') {
    if (!options?.overrideReason?.trim()) throw new ManualAllocationRequiresReasonError();
    const allocations = (options.manualLines ?? []).map((line) => {
      const lot = lots.find((l) => l.lotId === line.lotId);
      if (!lot) throw new Error(`Lot ${line.lotId} was not found among the lots available for allocation.`);
      if (effectiveStatus(lot, today) !== 'AVAILABLE') throw new LotNotAllocatableError(lot.lotId, effectiveStatus(lot, today));
      if (line.quantity > lot.available) throw new ManualAllocationExceedsAvailableError(lot.lotId, line.quantity, lot.available);
      return { ...lot, quantity: line.quantity };
    });
    const allocatedQty = allocations.reduce((sum, a) => sum + a.quantity, 0);
    return { allocations, shortage: Math.max(0, requestedQty - allocatedQty), strategy };
  }

  let remaining = requestedQty;
  const sorted = lots.filter((lot) => isAllocatable(lot, today)).sort((a, b) => {
    if (strategy === 'FIFO') return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    const aTime = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
  const allocations = [];
  for (const lot of sorted) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, lot.available);
    allocations.push({ ...lot, quantity });
    remaining -= quantity;
  }
  return { allocations, shortage: Math.max(0, remaining), strategy };
}

export const PICK_EXCEPTION_REASONS = ['NO_STOCK', 'WRONG_ITEM', 'DAMAGED_ITEM'] as const;

export function validatePickInput(input: { unit?: string; quantity: number; inputMethod: string; scanCode?: string; itemCode: string; lotNo: string }): void {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('Picked quantity must be greater than zero.');
  const unit = (input.unit ?? 'PCS').trim().toUpperCase();
  if (unit === 'PCS') {
    if (!Number.isInteger(input.quantity)) throw new Error('PCS quantity must be a whole number.');
    if (input.inputMethod !== 'SCAN') throw new Error('PCS items must be picked by barcode/QR scan.');
    const scan = (input.scanCode ?? '').trim().toLowerCase();
    if (!scan || ![input.itemCode, input.lotNo].some((value) => value.trim().toLowerCase() === scan)) throw new Error('Wrong Item: scan does not match the requested item or lot.');
  } else if (unit === 'KG') {
    if (input.inputMethod !== 'MANUAL') throw new Error('KG items use manual decimal entry.');
    if (Math.round(input.quantity * 1000) !== input.quantity * 1000) throw new Error('KG quantity supports up to 3 decimal places.');
  }
}
