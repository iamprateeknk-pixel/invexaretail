"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeReplenishment = routeReplenishment;
function routeReplenishment(destinationLocationId, requiredQty, network) {
    if (!Number.isFinite(requiredQty) || requiredQty <= 0) {
        return { action: 'NONE', suggestedTransferQty: 0, reason: 'Stock is at or above target.' };
    }
    const candidates = network
        .filter((row) => row.locationId !== destinationLocationId && row.available > 0)
        .sort((a, b) => {
        const warehousePriority = Number(String(b.locationType).toLowerCase() === 'warehouse') - Number(String(a.locationType).toLowerCase() === 'warehouse');
        return warehousePriority || b.available - a.available || a.locationName.localeCompare(b.locationName);
    });
    const source = candidates[0];
    if (!source) {
        return { action: 'PURCHASE', suggestedTransferQty: 0, reason: 'No other branch has available stock; purchase into H.O. Basni.' };
    }
    const quantity = Math.min(requiredQty, source.available);
    return {
        action: 'TRANSFER',
        sourceLocationId: source.locationId,
        sourceLocationName: source.locationName,
        suggestedTransferQty: quantity,
        reason: quantity >= requiredQty
            ? 'Target can be restored from network stock.'
            : 'Use available network stock first; purchase the remaining shortage into H.O. Basni.',
    };
}
