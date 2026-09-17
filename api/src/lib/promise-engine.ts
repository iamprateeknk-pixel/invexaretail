// Blueprint P5 "Promise engine: ATP/ATS with reservation expiry; estimated
// dispatch/delivery; safety buffer per channel." Reservation + expiry
// already exist on Order (reservedAt/reservationExpiresAt); this module adds
// the other half - a deterministic, explainable estimate of when an order
// will actually leave the warehouse and reach the customer. Per blueprint
// §8's "do not hide behind AI" rule: no ML, just a fixed pick/pack lead time
// plus a per-channel safety buffer, both visible in the result.

// Marketplaces impose stricter SLA/cancellation penalties than a store's own
// website, so they get a larger safety buffer baked into the promised date -
// better to under-promise than to miss a marketplace SLA.
export const CHANNEL_SAFETY_BUFFER_HOURS: Record<string, number> = {
  AMAZON: 4,
  FLIPKART: 4,
  WEBSITE: 2,
  DEFAULT: 2,
};

// Deterministic pick + pack processing time before an order can physically
// leave the warehouse, independent of channel.
export const PICK_PACK_LEAD_HOURS = 3;

export function channelSafetyBufferHours(channel: string): number {
  return CHANNEL_SAFETY_BUFFER_HOURS[channel.toUpperCase()] ?? CHANNEL_SAFETY_BUFFER_HOURS.DEFAULT;
}

export type DeliveryPromise = {
  estimatedDispatchAt: string;
  estimatedDeliveryAt: string | null;
  safetyBufferHours: number;
};

export function estimateDispatchAndDelivery(input: {
  reservedAt: Date;
  deliverySlaHours: number | null | undefined;
  channel: string;
}): DeliveryPromise {
  const bufferHours = channelSafetyBufferHours(input.channel);
  const dispatchAt = new Date(input.reservedAt.getTime() + (PICK_PACK_LEAD_HOURS + bufferHours) * 60 * 60 * 1000);
  const deliveryAt = typeof input.deliverySlaHours === 'number' && Number.isFinite(input.deliverySlaHours)
    ? new Date(dispatchAt.getTime() + input.deliverySlaHours * 60 * 60 * 1000)
    : null;
  return {
    estimatedDispatchAt: dispatchAt.toISOString(),
    estimatedDeliveryAt: deliveryAt ? deliveryAt.toISOString() : null,
    safetyBufferHours: bufferHours,
  };
}
