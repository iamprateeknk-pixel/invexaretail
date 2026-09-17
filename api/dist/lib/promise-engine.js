"use strict";
// Blueprint P5 "Promise engine: ATP/ATS with reservation expiry; estimated
// dispatch/delivery; safety buffer per channel." Reservation + expiry
// already exist on Order (reservedAt/reservationExpiresAt); this module adds
// the other half - a deterministic, explainable estimate of when an order
// will actually leave the warehouse and reach the customer. Per blueprint
// §8's "do not hide behind AI" rule: no ML, just a fixed pick/pack lead time
// plus a per-channel safety buffer, both visible in the result.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PICK_PACK_LEAD_HOURS = exports.CHANNEL_SAFETY_BUFFER_HOURS = void 0;
exports.channelSafetyBufferHours = channelSafetyBufferHours;
exports.estimateDispatchAndDelivery = estimateDispatchAndDelivery;
// Marketplaces impose stricter SLA/cancellation penalties than a store's own
// website, so they get a larger safety buffer baked into the promised date -
// better to under-promise than to miss a marketplace SLA.
exports.CHANNEL_SAFETY_BUFFER_HOURS = {
    AMAZON: 4,
    FLIPKART: 4,
    WEBSITE: 2,
    DEFAULT: 2,
};
// Deterministic pick + pack processing time before an order can physically
// leave the warehouse, independent of channel.
exports.PICK_PACK_LEAD_HOURS = 3;
function channelSafetyBufferHours(channel) {
    return exports.CHANNEL_SAFETY_BUFFER_HOURS[channel.toUpperCase()] ?? exports.CHANNEL_SAFETY_BUFFER_HOURS.DEFAULT;
}
function estimateDispatchAndDelivery(input) {
    const bufferHours = channelSafetyBufferHours(input.channel);
    const dispatchAt = new Date(input.reservedAt.getTime() + (exports.PICK_PACK_LEAD_HOURS + bufferHours) * 60 * 60 * 1000);
    const deliveryAt = typeof input.deliverySlaHours === 'number' && Number.isFinite(input.deliverySlaHours)
        ? new Date(dispatchAt.getTime() + input.deliverySlaHours * 60 * 60 * 1000)
        : null;
    return {
        estimatedDispatchAt: dispatchAt.toISOString(),
        estimatedDeliveryAt: deliveryAt ? deliveryAt.toISOString() : null,
        safetyBufferHours: bufferHours,
    };
}
