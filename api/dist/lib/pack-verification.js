"use strict";
// Blueprint P5 "Packing station: scan order/tote -> verify items ->
// cartonize -> weight/dimensions -> seal -> print pack slip/label." This
// module only decides whether what has been scanned matches the order -
// never touches the stock ledger or Order.status itself, so it cannot
// desync those invariants. A carton can only be sealed once every expected
// line matches exactly (no silent short-ship, no silent over-pack).
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPackScan = verifyPackScan;
function lineKey(itemId, lotId) {
    return `${itemId}|${lotId ?? ''}`;
}
function verifyPackScan(expected, scanned) {
    const scannedByKey = new Map();
    for (const line of scanned) {
        const key = lineKey(line.itemId, line.lotId);
        scannedByKey.set(key, (scannedByKey.get(key) ?? 0) + line.quantity);
    }
    const lines = [];
    const seenKeys = new Set();
    for (const line of expected) {
        const key = lineKey(line.itemId, line.lotId);
        seenKeys.add(key);
        const scannedQty = scannedByKey.get(key) ?? 0;
        const status = scannedQty === line.requestedQty ? 'MATCHED' : scannedQty < line.requestedQty ? 'SHORT' : 'OVER';
        lines.push({ itemId: line.itemId, lotId: line.lotId ?? null, requestedQty: line.requestedQty, scannedQty, status });
    }
    for (const [key, scannedQty] of scannedByKey) {
        if (seenKeys.has(key))
            continue;
        const [itemId, lotId] = key.split('|');
        lines.push({ itemId, lotId: lotId || null, requestedQty: 0, scannedQty, status: 'UNEXPECTED' });
    }
    const readyToSeal = lines.length > 0 && lines.every((line) => line.status === 'MATCHED');
    return { lines, readyToSeal };
}
