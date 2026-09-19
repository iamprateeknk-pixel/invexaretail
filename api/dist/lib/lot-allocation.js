"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocatePhysicalAcrossLots = allocatePhysicalAcrossLots;
function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}
function timestamp(value) {
    if (!value)
        return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
function compareLots(a, b, strategy) {
    if (strategy === 'FEFO') {
        const aExpiry = timestamp(a.expiryDate);
        const bExpiry = timestamp(b.expiryDate);
        if (aExpiry !== bExpiry)
            return aExpiry < bExpiry ? -1 : 1;
    }
    const aReceived = timestamp(a.receivedAt);
    const bReceived = timestamp(b.receivedAt);
    if (aReceived !== bReceived)
        return aReceived < bReceived ? -1 : 1;
    const bySequence = (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER);
    if (bySequence !== 0)
        return bySequence;
    return a.lotId.localeCompare(b.lotId);
}
/**
 * Deterministically allocates one item-level physical quantity across its
 * positive book lots. This is used by loose/weighted inventory where the
 * operator counts an item in KG instead of pretending to know the physical
 * quantity of every ERP lot.
 *
 * The allocator never creates a negative lot quantity. Quantity beyond the
 * total book stock is returned as excessQty and must be handled explicitly by
 * the caller (for example an exception/reconciliation bucket).
 */
function allocatePhysicalAcrossLots(input) {
    const precision = input.precision ?? 3;
    if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
        throw new Error('precision must be an integer between 0 and 6.');
    }
    if (!Number.isFinite(input.physicalQty) || input.physicalQty < 0) {
        throw new Error('physicalQty must be a finite non-negative number.');
    }
    const lots = input.lots
        .map((lot, index) => ({
        ...lot,
        sequence: lot.sequence ?? index,
        onHand: Number(lot.onHand),
    }))
        .filter((lot) => Number.isFinite(lot.onHand) && lot.onHand > 0)
        .sort((a, b) => compareLots(a, b, input.strategy ?? 'FIFO'));
    const physicalQty = round(input.physicalQty, precision);
    let remaining = physicalQty;
    const allocations = lots.map((lot) => {
        const bookQty = round(Math.max(0, lot.onHand), precision);
        const allocated = round(Math.min(bookQty, Math.max(0, remaining)), precision);
        remaining = round(Math.max(0, remaining - allocated), precision);
        return {
            lotId: lot.lotId,
            bookQty,
            physicalQty: allocated,
            variance: round(allocated - bookQty, precision),
        };
    });
    const totalBookQty = round(allocations.reduce((sum, row) => sum + row.bookQty, 0), precision);
    const allocatedQty = round(allocations.reduce((sum, row) => sum + row.physicalQty, 0), precision);
    const excessQty = round(Math.max(0, remaining), precision);
    return {
        allocations,
        totalBookQty,
        physicalQty,
        allocatedQty,
        excessQty,
        totalVariance: round(physicalQty - totalBookQty, precision),
    };
}
