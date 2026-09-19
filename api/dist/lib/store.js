"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInventoryItem = createInventoryItem;
exports.submitStockCount = submitStockCount;
exports.createTransferRequest = createTransferRequest;
function createInventoryItem(input) {
    const itemId = `item-${Math.random().toString(36).slice(2, 9)}`;
    const lotId = `lot-${Math.random().toString(36).slice(2, 9)}`;
    return {
        id: itemId,
        code: input.code,
        name: input.name,
        category: input.category,
        subcategory: input.subcategory,
        company: input.company,
        unit: input.unit,
        countMethod: input.countMethod,
        pickMethod: input.pickMethod,
        allocationStrategy: input.allocationStrategy,
        lotRequired: input.lotRequired,
        expiryRequired: input.expiryRequired,
        decimalQuantity: input.decimalQuantity,
        lots: [
            {
                id: lotId,
                itemId,
                lotNo: 'LOT-DEFAULT',
                expiryDate: null,
                attributes: { source: 'system-generated' },
            },
        ],
    };
}
function submitStockCount(input) {
    if (!input.itemId || !input.lotId || !input.locationId) {
        throw new Error('Item, lot and location are required for stock counts.');
    }
    if (!Number.isFinite(input.physicalQuantity) || input.physicalQuantity < 0) {
        throw new Error('Physical quantity must be a non-negative number.');
    }
    return {
        id: `count-${Math.random().toString(36).slice(2, 9)}`,
        itemId: input.itemId,
        lotId: input.lotId,
        locationId: input.locationId,
        physicalQuantity: Number(input.physicalQuantity),
        mode: input.mode,
        submittedBy: input.submittedBy,
        role: input.role,
        createdAt: new Date().toISOString(),
    };
}
function createTransferRequest(input) {
    if (!['ADMIN', 'ADMIN_USER', 'BRANCH_MANAGER', 'STORE_USER'].includes(input.role)) {
        throw new Error('Only admins, branch managers or store users can create transfer requests.');
    }
    if (!input.sourceLocationId || !input.destinationLocationId) {
        throw new Error('Source and destination locations are required.');
    }
    if (input.sourceLocationId === input.destinationLocationId) {
        throw new Error('Transfer source and destination cannot be the same.');
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
        throw new Error('At least one transfer line is required.');
    }
    for (const line of input.lines) {
        if (!line.itemId || !line.lotId) {
            throw new Error('Each transfer line requires item and lot identifiers.');
        }
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
            throw new Error('Transfer quantities must be positive numbers.');
        }
    }
    return {
        id: `transfer-${Math.random().toString(36).slice(2, 9)}`,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
        requestedBy: input.requestedBy,
        role: input.role,
        // REQUESTED, not SUBMITTED: no transition table defines a move out of
        // SUBMITTED, and picker tasks only surface REQUESTED, so a transfer
        // created as SUBMITTED could never be picked, dispatched or rejected.
        status: 'REQUESTED',
        lines: input.lines.map((line) => ({ ...line, quantity: Number(line.quantity) })),
        cartonCount: input.cartonCount,
        photos: input.photos,
        notes: input.notes,
        createdAt: new Date().toISOString(),
    };
}
