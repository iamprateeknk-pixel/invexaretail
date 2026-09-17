"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sequenceKeyForBin = sequenceKeyForBin;
exports.lastKnownBin = lastKnownBin;
const db_js_1 = require("./db.js");
/** Pure and unit-testable: turns a bin's hierarchy into a sortable walking-order key. Bin-less items sort last. */
function sequenceKeyForBin(bin) {
    if (!bin)
        return '~unassigned';
    return [bin.zone, bin.aisle, bin.rack, bin.shelf, bin.code].filter(Boolean).join('-');
}
async function lastKnownBin(locationId, itemId, lotId) {
    try {
        const lotMatch = await db_js_1.prisma.putawayTask.findFirst({
            where: { locationId, itemId, lotId, status: 'CONFIRMED', confirmedBinId: { not: null } },
            orderBy: { confirmedAt: 'desc' },
            include: { confirmedBin: true },
        });
        if (lotMatch?.confirmedBin)
            return lotMatch.confirmedBin;
        const itemMatch = await db_js_1.prisma.putawayTask.findFirst({
            where: { locationId, itemId, status: 'CONFIRMED', confirmedBinId: { not: null } },
            orderBy: { confirmedAt: 'desc' },
            include: { confirmedBin: true },
        });
        return itemMatch?.confirmedBin ?? null;
    }
    catch {
        return null;
    }
}
