"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPickerTask = buildPickerTask;
exports.completePickerTask = completePickerTask;
function buildPickerTask(input) {
    if (input.role !== 'WAREHOUSE_PICKER') {
        throw new Error('Only warehouse pickers can build picker tasks.');
    }
    if (!input.transferId || !input.locationId) {
        throw new Error('Transfer ID and location are required.');
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
        throw new Error('At least one pick line is required.');
    }
    return {
        transferId: input.transferId,
        locationId: input.locationId,
        lines: input.lines.map((line) => ({ ...line, quantity: Number(line.quantity) })),
        assignedPickerId: input.assignedPickerId,
        role: input.role,
        status: 'ASSIGNED',
    };
}
function completePickerTask(input) {
    if (input.role !== 'WAREHOUSE_PICKER') {
        throw new Error('Only warehouse pickers can complete pick tasks.');
    }
    if (!input.transferId || !input.pickerId) {
        throw new Error('Transfer ID and picker ID are required.');
    }
    if (!Number.isFinite(input.pickedQty) || input.pickedQty <= 0) {
        throw new Error('Picked quantity must be a positive number.');
    }
    return {
        transferId: input.transferId,
        pickerId: input.pickerId,
        role: input.role,
        status: 'PICKED',
        pickedQty: Number(input.pickedQty),
    };
}
