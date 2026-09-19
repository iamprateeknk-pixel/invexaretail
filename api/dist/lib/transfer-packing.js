"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeCartons = activeCartons;
exports.packedTotals = packedTotals;
exports.remainingToPack = remainingToPack;
exports.checkCartonLines = checkCartonLines;
exports.verifyTransferPacking = verifyTransferPacking;
exports.nextCartonNumber = nextCartonNumber;
exports.packageIdFor = packageIdFor;
exports.isTransitDelayed = isTransitDelayed;
exports.parseDispatchDetails = parseDispatchDetails;
const pack_verification_js_1 = require("./pack-verification.js");
const round3 = (value) => Math.round(value * 1000) / 1000;
const keyOf = (itemId, lotId) => `${itemId}|${lotId}`;
/** Sealed cartons only: a voided carton no longer counts as packed. */
function activeCartons(cartons) {
    return cartons.filter((carton) => carton.status === 'SEALED');
}
function packedTotals(cartons) {
    const totals = new Map();
    for (const carton of activeCartons(cartons)) {
        for (const line of carton.lines) {
            const key = keyOf(line.itemId, line.lotId);
            totals.set(key, round3((totals.get(key) ?? 0) + line.quantity));
        }
    }
    return totals;
}
function remainingToPack(expected, cartons) {
    const packed = packedTotals(cartons);
    const remaining = new Map();
    for (const line of expected) {
        const key = keyOf(line.itemId, line.lotId ?? '');
        remaining.set(key, round3(Math.max(0, line.requestedQty - (packed.get(key) ?? 0))));
    }
    return remaining;
}
/** What is wrong with a carton about to be sealed. Empty means it can be sealed. */
function checkCartonLines(expected, cartons, lines) {
    const remaining = remainingToPack(expected, cartons);
    const inCarton = new Map();
    const mismatches = [];
    for (const line of lines) {
        const key = keyOf(line.itemId, line.lotId);
        inCarton.set(key, round3((inCarton.get(key) ?? 0) + line.quantity));
    }
    for (const [key, quantity] of inCarton) {
        const [itemId, lotId] = key.split('|');
        if (!remaining.has(key)) {
            mismatches.push({ itemId, lotId, kind: 'UNEXPECTED', quantity, remaining: 0 });
        }
        else if (quantity > remaining.get(key)) {
            mismatches.push({ itemId, lotId, kind: 'OVER', quantity, remaining: remaining.get(key) });
        }
    }
    return mismatches;
}
function verifyTransferPacking(expected, cartons) {
    const scanned = [...packedTotals(cartons)].map(([key, quantity]) => {
        const [itemId, lotId] = key.split('|');
        return { itemId, lotId, quantity };
    });
    return (0, pack_verification_js_1.verifyPackScan)(expected, scanned);
}
function nextCartonNumber(cartons) {
    return cartons.reduce((max, carton) => Math.max(max, Number(carton.cartonNumber) || 0), 0) + 1;
}
function packageIdFor(transferId, cartonNumber) {
    const tail = transferId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase().padStart(6, '0');
    return `PKG-${tail}-${String(cartonNumber).padStart(2, '0')}`;
}
/** Transit tracking (blueprint §17): past its promised arrival and still not received. */
function isTransitDelayed(input) {
    if (!input.expectedArrivalAt)
        return false;
    if (!['DISPATCHED', 'IN_TRANSIT', 'PARTIAL_RECEIVED', 'PARTIALLY_RECEIVED'].includes(input.status))
        return false;
    const expected = Date.parse(input.expectedArrivalAt);
    return Number.isFinite(expected) && expected < (input.now ?? new Date()).getTime();
}
const text = (value, max) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string')
        throw new Error('Dispatch details must be text.');
    const trimmed = value.trim();
    if (trimmed.length > max)
        throw new Error(`Dispatch details are limited to ${max} characters.`);
    return trimmed || undefined;
};
/** Blueprint §17 Dispatch: vehicle, courier or AWB is required, plus an optional promised arrival. */
function parseDispatchDetails(body, now = new Date()) {
    const carrier = text(body.carrier, 120);
    const awb = text(body.awb, 120);
    const vehicleNo = text(body.vehicleNo, 60);
    if (!carrier && !awb && !vehicleNo) {
        throw new Error('Enter the vehicle number, courier or AWB before dispatching.');
    }
    const details = { ...(carrier ? { carrier } : {}), ...(awb ? { awb } : {}), ...(vehicleNo ? { vehicleNo } : {}) };
    const arrival = text(body.expectedArrivalAt, 40);
    if (arrival) {
        const parsed = Date.parse(arrival);
        if (!Number.isFinite(parsed))
            throw new Error('Expected arrival must be a valid date and time.');
        if (parsed < now.getTime() - 24 * 60 * 60 * 1000)
            throw new Error('Expected arrival cannot be in the past.');
        details.expectedArrivalAt = new Date(parsed).toISOString();
    }
    return details;
}
