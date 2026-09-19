import { verifyPackScan, type ExpectedPackLine, type PackVerification } from './pack-verification.js';

// Blueprint v4 §16 Packing (for stock transfers): picked work is packed into
// one or more cartons, and packing re-verifies what goes in rather than
// trusting the picker's completion. A carton that would over-pack or hold an
// item that is not on the transfer cannot be sealed, and packing cannot be
// completed until every expected line is fully covered by sealed cartons.

export type CartonLine = { itemId: string; lotId: string; quantity: number };

export type TransferCartonRecord = {
  id: string;
  transferId: string;
  cartonNumber: string;
  // Printed as the carton label / QR. Scanning it at the destination opens the transfer.
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

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const keyOf = (itemId: string, lotId: string) => `${itemId}|${lotId}`;

/** Sealed cartons only: a voided carton no longer counts as packed. */
export function activeCartons(cartons: TransferCartonRecord[]): TransferCartonRecord[] {
  return cartons.filter((carton) => carton.status === 'SEALED');
}

export function packedTotals(cartons: TransferCartonRecord[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const carton of activeCartons(cartons)) {
    for (const line of carton.lines) {
      const key = keyOf(line.itemId, line.lotId);
      totals.set(key, round3((totals.get(key) ?? 0) + line.quantity));
    }
  }
  return totals;
}

export function remainingToPack(expected: ExpectedPackLine[], cartons: TransferCartonRecord[]): Map<string, number> {
  const packed = packedTotals(cartons);
  const remaining = new Map<string, number>();
  for (const line of expected) {
    const key = keyOf(line.itemId, line.lotId ?? '');
    remaining.set(key, round3(Math.max(0, line.requestedQty - (packed.get(key) ?? 0))));
  }
  return remaining;
}

/** What is wrong with a carton about to be sealed. Empty means it can be sealed. */
export function checkCartonLines(expected: ExpectedPackLine[], cartons: TransferCartonRecord[], lines: CartonLine[]): PackMismatch[] {
  const remaining = remainingToPack(expected, cartons);
  const inCarton = new Map<string, number>();
  const mismatches: PackMismatch[] = [];
  for (const line of lines) {
    const key = keyOf(line.itemId, line.lotId);
    inCarton.set(key, round3((inCarton.get(key) ?? 0) + line.quantity));
  }
  for (const [key, quantity] of inCarton) {
    const [itemId, lotId] = key.split('|');
    if (!remaining.has(key)) {
      mismatches.push({ itemId, lotId, kind: 'UNEXPECTED', quantity, remaining: 0 });
    } else if (quantity > remaining.get(key)!) {
      mismatches.push({ itemId, lotId, kind: 'OVER', quantity, remaining: remaining.get(key)! });
    }
  }
  return mismatches;
}

export function verifyTransferPacking(expected: ExpectedPackLine[], cartons: TransferCartonRecord[]): PackVerification {
  const scanned = [...packedTotals(cartons)].map(([key, quantity]) => {
    const [itemId, lotId] = key.split('|');
    return { itemId, lotId, quantity };
  });
  return verifyPackScan(expected, scanned);
}

export function nextCartonNumber(cartons: TransferCartonRecord[]): number {
  return cartons.reduce((max, carton) => Math.max(max, Number(carton.cartonNumber) || 0), 0) + 1;
}

export function packageIdFor(transferId: string, cartonNumber: number): string {
  const tail = transferId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase().padStart(6, '0');
  return `PKG-${tail}-${String(cartonNumber).padStart(2, '0')}`;
}

/** Transit tracking (blueprint §17): past its promised arrival and still not received. */
export function isTransitDelayed(input: { status: string; expectedArrivalAt?: string; now?: Date }): boolean {
  if (!input.expectedArrivalAt) return false;
  if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(input.status)) return false;
  const expected = Date.parse(input.expectedArrivalAt);
  return Number.isFinite(expected) && expected < (input.now ?? new Date()).getTime();
}

export type DispatchDetails = {
  carrier?: string;
  awb?: string;
  vehicleNo?: string;
  expectedArrivalAt?: string;
};

const text = (value: unknown, max: number): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Dispatch details must be text.');
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`Dispatch details are limited to ${max} characters.`);
  return trimmed || undefined;
};

/** Blueprint §17 Dispatch: vehicle, courier or AWB is required, plus an optional promised arrival. */
export function parseDispatchDetails(body: Record<string, unknown>, now = new Date()): DispatchDetails {
  const carrier = text(body.carrier, 120);
  const awb = text(body.awb, 120);
  const vehicleNo = text(body.vehicleNo, 60);
  if (!carrier && !awb && !vehicleNo) {
    throw new Error('Enter the vehicle number, courier or AWB before dispatching.');
  }
  const details: DispatchDetails = { ...(carrier ? { carrier } : {}), ...(awb ? { awb } : {}), ...(vehicleNo ? { vehicleNo } : {}) };
  const arrival = text(body.expectedArrivalAt, 40);
  if (arrival) {
    const parsed = Date.parse(arrival);
    if (!Number.isFinite(parsed)) throw new Error('Expected arrival must be a valid date and time.');
    if (parsed < now.getTime() - 24 * 60 * 60 * 1000) throw new Error('Expected arrival cannot be in the past.');
    details.expectedArrivalAt = new Date(parsed).toISOString();
  }
  return details;
}
