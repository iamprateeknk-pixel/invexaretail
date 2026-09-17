"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpiryWriteOffError = void 0;
exports.expiryAlertId = expiryAlertId;
exports.assertCanWriteOffExpiry = assertCanWriteOffExpiry;
exports.parseWriteOffReason = parseWriteOffReason;
exports.buildLocationExpiryBoard = buildLocationExpiryBoard;
exports.listLocationExpiryAlerts = listLocationExpiryAlerts;
exports.writeOffExpiryLot = writeOffExpiryLot;
exports.setLotExpiryDate = setLotExpiryDate;
exports.setLotSaleStatus = setLotSaleStatus;
const node_crypto_1 = require("node:crypto");
const expiry_alerts_js_1 = require("./expiry-alerts.js");
const expiry_board_js_1 = require("./expiry-board.js");
const repository_js_1 = require("./repository.js");
class ExpiryWriteOffError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = 'ExpiryWriteOffError';
    }
}
exports.ExpiryWriteOffError = ExpiryWriteOffError;
function expiryAlertId(itemId, lotId, locationId) {
    return `expiry-${(0, node_crypto_1.createHash)('sha1').update(`${itemId}|${lotId}|${locationId}`).digest('hex').slice(0, 24)}`;
}
function assertCanWriteOffExpiry(role) {
    if (role !== 'ADMIN') {
        throw new ExpiryWriteOffError('Only the Main Admin can post an expiry write-off.', 403);
    }
}
function parseWriteOffReason(value) {
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length < 5) {
        throw new ExpiryWriteOffError('A write-off reason of at least 5 characters is required.', 400);
    }
    return reason;
}
function buildLocationExpiryBoard(locationId, now = new Date()) {
    const items = (0, repository_js_1.listItems)();
    const stock = (0, repository_js_1.listStockLedgerForLocation)(locationId);
    return (0, expiry_board_js_1.buildExpiryBoard)({
        items,
        lots: items.flatMap((item) => item.lots),
        stock: stock.map((row) => ({
            itemId: row.itemId,
            lotId: row.lotId,
            locationId: row.locationId,
            quantity: row.onHand,
        })),
        now,
    });
}
function listLocationExpiryAlerts(locationId, now = new Date()) {
    const items = (0, repository_js_1.listItems)();
    const itemMap = new Map(items.map((item) => [item.id, item]));
    return (0, repository_js_1.listStockLedgerForLocation)(locationId)
        .filter((row) => row.onHand > 0)
        .map((row) => {
        const item = itemMap.get(row.itemId);
        const lot = item?.lots.find((entry) => entry.id === row.lotId);
        if (!item || !lot?.expiryDate)
            return null;
        const expiry = new Date(lot.expiryDate);
        if (Number.isNaN(expiry.getTime()))
            return null;
        const days = (0, expiry_alerts_js_1.daysUntilExpiry)(expiry, now);
        return {
            id: expiryAlertId(row.itemId, row.lotId, row.locationId),
            itemId: row.itemId,
            lotId: row.lotId,
            locationId: row.locationId,
            quantity: row.onHand,
            expiryDate: lot.expiryDate,
            daysUntilExpiry: days,
            status: 'ACTIVE',
            recommendedAction: (0, expiry_alerts_js_1.recommendedExpiryAction)(days),
            item: { code: item.code, name: item.name },
            lot: { lotNo: lot.lotNo, status: lot.status ?? 'AVAILABLE' },
            severity: (0, expiry_alerts_js_1.expirySeverity)(days),
        };
    })
        .filter((alert) => Boolean(alert))
        .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}
function writeOffExpiryLot(input) {
    assertCanWriteOffExpiry(input.role);
    const reason = parseWriteOffReason(input.reason);
    const item = (0, repository_js_1.listItems)().find((entry) => entry.id === input.itemId);
    const lot = item?.lots.find((entry) => entry.id === input.lotId);
    if (!item || !lot)
        throw new ExpiryWriteOffError('Lot not found.', 404);
    const ledger = (0, repository_js_1.findStockLedgerEntry)(input.itemId, input.lotId, input.locationId);
    const requested = Number(input.quantity);
    const quantity = Number.isFinite(requested) && requested > 0 ? requested : Number(ledger?.onHand ?? 0);
    if (!ledger || quantity <= 0 || quantity > ledger.onHand) {
        throw new ExpiryWriteOffError('Write-off quantity exceeds current lot stock.', 400);
    }
    const alertId = expiryAlertId(input.itemId, input.lotId, input.locationId);
    const beforeBalance = ledger.onHand;
    const after = (0, repository_js_1.adjustStockLedger)(input.itemId, input.lotId, input.locationId, -quantity);
    const movement = {
        id: `mv-exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: input.itemId,
        lotId: input.lotId,
        locationId: input.locationId,
        movementType: 'EXPIRY_WRITE_OFF',
        qtyDelta: -quantity,
        beforeBalance,
        afterBalance: after.onHand,
        sourceDocument: alertId,
        actor: input.actorId,
        timestamp: new Date().toISOString(),
        correlationId: alertId,
        reason,
        metadata: { expiryDate: lot.expiryDate ?? null, alertId },
    };
    repository_js_1.stockMovements.push(movement);
    if ((lot.status ?? 'AVAILABLE') === 'AVAILABLE' && lot.expiryDate && (0, expiry_alerts_js_1.daysUntilExpiry)(new Date(lot.expiryDate)) < 0) {
        try {
            (0, repository_js_1.updateLotStatus)(lot.id, 'EXPIRED');
        }
        catch {
            // Status is advisory; stock has already been written off.
        }
    }
    return { alertId, movementId: movement.id, quantity, beforeBalance, afterBalance: after.onHand };
}
function setLotExpiryDate(lotId, raw) {
    let expiryDate = null;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        const parsed = new Date(String(raw));
        if (Number.isNaN(parsed.getTime()))
            throw new ExpiryWriteOffError('Expiry date is invalid.', 400);
        expiryDate = parsed.toISOString();
    }
    return (0, repository_js_1.updateLotExpiry)(lotId, expiryDate);
}
function setLotSaleStatus(lotId, status) {
    const valid = ['AVAILABLE', 'EXPIRED', 'BLOCKED', 'QUARANTINE'];
    if (!valid.includes(status)) {
        throw new ExpiryWriteOffError('Invalid lot status.', 400);
    }
    return (0, repository_js_1.updateLotStatus)(lotId, status);
}
