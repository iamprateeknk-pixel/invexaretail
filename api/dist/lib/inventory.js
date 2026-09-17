"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeVariance = computeVariance;
exports.canAccessLocation = canAccessLocation;
exports.sanitizeStockForRole = sanitizeStockForRole;
exports.validateBlindCountSubmission = validateBlindCountSubmission;
exports.validateTransferRequest = validateTransferRequest;
exports.validateTransferStatusChange = validateTransferStatusChange;
const transfer_lifecycle_js_1 = require("./transfer-lifecycle.js");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
function computeVariance(bookQuantity, physicalQuantity) {
    return physicalQuantity - bookQuantity;
}
function canAccessLocation(context, locationId) {
    if (!locationId) {
        return false;
    }
    if (context.companyId && !(0, tenant_scope_js_1.companyOwnsLocation)(context.companyId, locationId)) {
        return false;
    }
    if (context.role === 'ADMIN' || context.role === 'ADMIN_USER') {
        return true;
    }
    return context.assignedLocationIds.includes(locationId);
}
function sanitizeStockForRole(role, snapshot) {
    if (role === 'STORE_USER') {
        return {
            itemId: snapshot.itemId,
            ...(snapshot.lotId ? { lotId: snapshot.lotId } : {}),
            locationId: snapshot.locationId,
            physicalQuantity: snapshot.physicalQuantity,
        };
    }
    const variance = snapshot.variance ?? computeVariance(snapshot.bookQuantity ?? 0, snapshot.physicalQuantity);
    return {
        itemId: snapshot.itemId,
        ...(snapshot.lotId ? { lotId: snapshot.lotId } : {}),
        locationId: snapshot.locationId,
        bookQuantity: snapshot.bookQuantity ?? 0,
        physicalQuantity: snapshot.physicalQuantity,
        variance,
        stockValue: snapshot.stockValue ?? 0,
        // Blueprint section 7.2: quarantine/damaged are visible to every role
        // except Store User (kept minimal by design above) so a manager can
        // see rejected stock without it inflating sellable availability.
        quarantineQuantity: snapshot.quarantineQuantity ?? 0,
        damagedQuantity: snapshot.damagedQuantity ?? 0,
        reservedQuantity: snapshot.reservedQuantity ?? 0,
        availableQuantity: snapshot.availableQuantity ?? snapshot.physicalQuantity,
    };
}
function validateBlindCountSubmission(role, input) {
    if (!input?.itemId || !input?.locationId) {
        throw new Error('Item and location are required for a count submission.');
    }
    if (!Number.isFinite(input.physicalQuantity) || input.physicalQuantity < 0) {
        throw new Error('Physical quantity must be a non-negative number.');
    }
    if (role === 'STORE_USER') {
        if ('bookQuantity' in input && input.bookQuantity !== undefined) {
            throw new Error('Store users cannot submit book quantity in blind counts.');
        }
        if ('variance' in input && input.variance !== undefined) {
            throw new Error('Store users cannot submit variance values in blind counts.');
        }
        if ('stockValue' in input && input.stockValue !== undefined) {
            throw new Error('Store users cannot submit stock value in blind counts.');
        }
    }
    const normalized = {
        ...input,
        physicalQuantity: Number(input.physicalQuantity),
    };
    if (typeof input.bookQuantity === 'number') {
        normalized.variance = computeVariance(input.bookQuantity, normalized.physicalQuantity);
    }
    return normalized;
}
function validateTransferRequest(role, input) {
    if (!(0, transfer_lifecycle_js_1.canCreateTransfer)(role)) {
        throw new Error('Only admins, branch managers or store users can create transfer requests.');
    }
    if (!input.sourceLocationId || !input.destinationLocationId) {
        throw new Error('Source and destination locations are required.');
    }
    if (input.sourceLocationId === input.destinationLocationId) {
        throw new Error('A transfer cannot have the same source and destination.');
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
        throw new Error('At least one transfer line is required.');
    }
    for (const line of input.lines) {
        if (!line.itemId || !line.lotId) {
            throw new Error('Each transfer line requires an item and lot.');
        }
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
            throw new Error('Transfer quantities must be positive numbers.');
        }
    }
    return { ...input, lines: input.lines.map((line) => ({ ...line, quantity: Number(line.quantity) })) };
}
function validateTransferStatusChange(role, currentStatus, nextStatus) {
    (0, transfer_lifecycle_js_1.assertValidTransferTransition)(role, currentStatus, nextStatus);
}
