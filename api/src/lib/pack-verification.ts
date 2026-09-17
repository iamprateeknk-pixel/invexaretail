// Blueprint P5 "Packing station: scan order/tote -> verify items ->
// cartonize -> weight/dimensions -> seal -> print pack slip/label." This
// module only decides whether what has been scanned matches the order -
// never touches the stock ledger or Order.status itself, so it cannot
// desync those invariants. A carton can only be sealed once every expected
// line matches exactly (no silent short-ship, no silent over-pack).

export type ExpectedPackLine = {
  itemId: string;
  lotId?: string | null;
  requestedQty: number;
};

export type ScannedPackLine = {
  itemId: string;
  lotId?: string | null;
  quantity: number;
};

export type PackLineStatus = 'MATCHED' | 'SHORT' | 'OVER' | 'UNEXPECTED';

export type PackLineResult = {
  itemId: string;
  lotId: string | null;
  requestedQty: number;
  scannedQty: number;
  status: PackLineStatus;
};

export type PackVerification = {
  lines: PackLineResult[];
  readyToSeal: boolean;
};

function lineKey(itemId: string, lotId?: string | null): string {
  return `${itemId}|${lotId ?? ''}`;
}

export function verifyPackScan(expected: ExpectedPackLine[], scanned: ScannedPackLine[]): PackVerification {
  const scannedByKey = new Map<string, number>();
  for (const line of scanned) {
    const key = lineKey(line.itemId, line.lotId);
    scannedByKey.set(key, (scannedByKey.get(key) ?? 0) + line.quantity);
  }

  const lines: PackLineResult[] = [];
  const seenKeys = new Set<string>();
  for (const line of expected) {
    const key = lineKey(line.itemId, line.lotId);
    seenKeys.add(key);
    const scannedQty = scannedByKey.get(key) ?? 0;
    const status: PackLineStatus = scannedQty === line.requestedQty ? 'MATCHED' : scannedQty < line.requestedQty ? 'SHORT' : 'OVER';
    lines.push({ itemId: line.itemId, lotId: line.lotId ?? null, requestedQty: line.requestedQty, scannedQty, status });
  }

  for (const [key, scannedQty] of scannedByKey) {
    if (seenKeys.has(key)) continue;
    const [itemId, lotId] = key.split('|');
    lines.push({ itemId, lotId: lotId || null, requestedQty: 0, scannedQty, status: 'UNEXPECTED' });
  }

  const readyToSeal = lines.length > 0 && lines.every((line) => line.status === 'MATCHED');
  return { lines, readyToSeal };
}
