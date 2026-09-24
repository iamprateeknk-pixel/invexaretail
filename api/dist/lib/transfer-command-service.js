"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsufficientStockError = exports.TransferExpiryBlockedError = exports.TransferValidationError = exports.TransferRoleError = void 0;
exports.createTransfer = createTransfer;
// Week 8: command/query service for the Transfer slice extracted out of
// routes/core.ts (the "god router"). This is the layer the guide asks for
// between a thin route and the domain/repository code: it owns the
// create-transfer workflow (validation, reservation, persistence, audit,
// and rollback-on-failure), so routes/transfers.ts's handler is just
// "parse request, call service, map result to response."
const inventory_js_1 = require("./inventory.js");
const transfer_lifecycle_js_1 = require("./transfer-lifecycle.js");
const repository_js_1 = require("./repository.js");
const store_js_1 = require("./store.js");
const transfer_repository_js_1 = require("./repositories/transfer-repository.js");
const item_master_js_1 = require("./item-master.js");
const industry_packs_js_1 = require("./industry-packs.js");
const reservation_js_1 = require("./reservation.js");
Object.defineProperty(exports, "InsufficientStockError", { enumerable: true, get: function () { return reservation_js_1.InsufficientStockError; } });
const audit_js_1 = require("./audit.js");
const persistence_js_1 = require("./persistence.js");
class TransferRoleError extends Error {
}
exports.TransferRoleError = TransferRoleError;
class TransferValidationError extends Error {
}
exports.TransferValidationError = TransferValidationError;
class TransferExpiryBlockedError extends Error {
}
exports.TransferExpiryBlockedError = TransferExpiryBlockedError;
function inactiveItemMessage(itemIds) {
    const catalog = (0, repository_js_1.listItems)();
    for (const id of itemIds) {
        const item = catalog.find((entry) => entry.id === id);
        if (item && !(0, item_master_js_1.isOperationalItem)(item)) {
            return `Item ${item.code} is ${String(item.status).toLowerCase()} and cannot be used in new transactions.`;
        }
    }
    return null;
}
/**
 * Creates a transfer request: validates the payload, blocks expired/
 * quarantined lots when the active workflow requires it, reserves stock
 * (Week 7's atomic reservation primitive) before the transfer row exists so
 * a second concurrent request against the same low-stock lot is rejected
 * here rather than discovering the shortfall later, and releases the
 * reservation if persisting the transfer itself then fails - unchanged
 * behavior from the version of this logic that lived inline in
 * routes/core.ts's `POST /transfers` handler before this week's extraction.
 */
async function createTransfer(cmd) {
    const { context, input } = cmd;
    if (!(0, transfer_lifecycle_js_1.canCreateTransfer)(context.role)) {
        throw new TransferRoleError('This role cannot create transfer requests.');
    }
    if (context.role === 'BRANCH_MANAGER' && !(0, inventory_js_1.canAccessLocation)(context, input.sourceLocationId)) {
        throw new TransferRoleError('Branch managers can only create transfers from assigned locations.');
    }
    if (context.role === 'STORE_USER') {
        if (!(0, inventory_js_1.canAccessLocation)(context, input.sourceLocationId)) {
            throw new TransferRoleError('Store user can only request from an assigned location.');
        }
        const destination = (0, repository_js_1.listLocations)().find((location) => location.id === input.destinationLocationId);
        if (destination?.type !== 'warehouse') {
            throw new TransferValidationError('Store transfer destination must be a warehouse.');
        }
    }
    const cartonCount = (0, transfer_lifecycle_js_1.parseCartonCount)(input.cartonCount);
    const validated = (0, inventory_js_1.validateTransferRequest)(context.role, { ...input, cartonCount });
    const inactiveTransferItem = inactiveItemMessage(validated.lines.map((line) => line.itemId));
    if (inactiveTransferItem)
        throw new TransferValidationError(inactiveTransferItem);
    const workflow = (0, industry_packs_js_1.getActiveWorkflow)();
    if (workflow.expiryBlocking) {
        const expired = validated.lines.filter((line) => {
            const item = (0, repository_js_1.listItems)().find((entry) => entry.id === line.itemId);
            const lot = item?.lots.find((entry) => entry.id === line.lotId);
            if (!lot)
                return false;
            if (lot.status && lot.status !== 'AVAILABLE')
                return true;
            return Boolean(lot.expiryDate && new Date(lot.expiryDate).getTime() < Date.now());
        });
        if (expired.length) {
            throw new TransferExpiryBlockedError('Expired or quarantined lots cannot be transferred while expiry blocking is on.');
        }
    }
    // Blueprint §7.2/§9: reserve before creating the request so a second
    // concurrent request against the same low-stock lot is rejected here
    // rather than discovering the shortfall later, one pick at a time.
    await (0, reservation_js_1.reserveStockForTransfer)(validated.lines.map((line) => ({ itemId: line.itemId, lotId: line.lotId, locationId: validated.sourceLocationId, quantity: line.quantity })), { companyId: cmd.companyId, actorId: cmd.actorId, requestId: cmd.requestId, traceId: cmd.traceId });
    try {
        const saved = (0, store_js_1.createTransferRequest)({
            sourceLocationId: validated.sourceLocationId,
            destinationLocationId: validated.destinationLocationId,
            requestedBy: cmd.actorId,
            role: context.role === 'WAREHOUSE_PICKER' || context.role === 'AUDITOR' ? 'ADMIN' : context.role,
            lines: validated.lines,
            cartonCount,
            photos: input.photos,
            notes: input.notes,
        });
        (0, transfer_repository_js_1.createTransferRecord)({
            id: saved.id,
            sourceLocationId: saved.sourceLocationId,
            destinationLocationId: saved.destinationLocationId,
            requestedBy: saved.requestedBy,
            role: saved.role,
            status: saved.status,
            lines: saved.lines,
            cartonCount: saved.cartonCount,
            photos: saved.photos,
            notes: saved.notes,
            createdAt: saved.createdAt,
        });
        await (0, persistence_js_1.persistTransfer)(saved, cmd.companyId);
        await (0, persistence_js_1.persistAudit)((0, audit_js_1.recordAudit)({
            actorId: cmd.actorId,
            actorRole: cmd.actorRole,
            action: 'TRANSFER_REQUESTED',
            entityType: 'Transfer',
            entityId: saved.id,
        }));
        return saved;
    }
    catch (error) {
        // The reservation above already committed; do not leave it stranded
        // against a transfer that was never actually created.
        void (0, reservation_js_1.releaseReservedStock)(validated.lines.map((line) => ({
            itemId: line.itemId, lotId: line.lotId, locationId: validated.sourceLocationId, quantity: line.quantity,
        })));
        throw error;
    }
}
