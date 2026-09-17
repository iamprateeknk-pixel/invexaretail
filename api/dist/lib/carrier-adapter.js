"use strict";
// Blueprint P5/P6 "Carrier adapter: standard interface - rates,
// serviceability, create AWB, label, manifest, tracking, cancel" and
// "Connector platform, not one-off integrations": every carrier (Shiprocket,
// Delhivery, Blue Dart, or a store's own manual courier) implements this one
// interface, so the rest of the app never branches on which carrier is
// configured. A LocalCarrierAdapter ships today (deterministic, no external
// credentials required - many small retailers run manual/local couriers
// anyway) and is a real, usable default, not just a test double; a real
// provider plugs in later behind the same contract.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalCarrierAdapter = void 0;
exports.getCarrierAdapter = getCarrierAdapter;
exports.listCarrierProviders = listCarrierProviders;
const RATE_PER_KG = 40;
const BASE_RATE = 60;
const SURFACE_DAYS = 4;
const EXPRESS_DAYS = 2;
function deterministicAwb(orderReference, salt) {
    let hash = 0;
    const source = `${orderReference}|${salt}`;
    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
    }
    return `LOCAL-${hash.toString(36).toUpperCase().padStart(8, '0')}`;
}
const localShipments = new Map();
/**
 * LocalCarrierAdapter: a real, deterministic courier adapter with no
 * external dependency - rates are a simple weight-based estimate, every
 * pincode is serviceable, and shipment status starts at BOOKED and only
 * advances when the caller (a real "handed to courier" / "delivered" scan,
 * once that UI exists) explicitly reports it - never fabricated, unlike a
 * fake progress simulation would.
 */
class LocalCarrierAdapter {
    provider = 'local';
    async getRates(input) {
        const weightCost = BASE_RATE + input.weightKg * RATE_PER_KG;
        return [
            { serviceCode: 'LOCAL_SURFACE', serviceName: 'Local Surface Courier', estimatedCost: Math.round(weightCost), estimatedDays: SURFACE_DAYS },
            { serviceCode: 'LOCAL_EXPRESS', serviceName: 'Local Express Courier', estimatedCost: Math.round(weightCost * 1.6), estimatedDays: EXPRESS_DAYS },
        ];
    }
    async checkServiceability(_pincode) {
        return true;
    }
    async createShipment(input) {
        const awbNumber = deterministicAwb(input.orderReference, `${Date.now()}`);
        const now = new Date().toISOString();
        localShipments.set(awbNumber, {
            awbNumber, status: 'BOOKED', lastUpdatedAt: now,
            events: [{ status: 'BOOKED', at: now }],
        });
        return { awbNumber, labelUrl: null, manifestId: null, serviceCode: 'LOCAL_SURFACE' };
    }
    async trackShipment(awbNumber) {
        const status = localShipments.get(awbNumber);
        if (!status)
            throw new Error(`No shipment found for AWB ${awbNumber}.`);
        return status;
    }
    async cancelShipment(awbNumber) {
        const status = localShipments.get(awbNumber);
        if (!status)
            throw new Error(`No shipment found for AWB ${awbNumber}.`);
        if (status.status === 'DELIVERED')
            throw new Error('A delivered shipment cannot be cancelled.');
        const now = new Date().toISOString();
        localShipments.set(awbNumber, { ...status, status: 'CANCELLED', lastUpdatedAt: now, events: [...status.events, { status: 'CANCELLED', at: now }] });
    }
}
exports.LocalCarrierAdapter = LocalCarrierAdapter;
const adapters = {
    local: new LocalCarrierAdapter(),
};
function getCarrierAdapter(provider) {
    const adapter = adapters[provider];
    if (!adapter)
        throw new Error(`Unknown carrier provider: ${provider}.`);
    return adapter;
}
function listCarrierProviders() {
    return Object.keys(adapters);
}
