export declare const CHANNEL_SAFETY_BUFFER_HOURS: Record<string, number>;
export declare const PICK_PACK_LEAD_HOURS = 3;
export declare function channelSafetyBufferHours(channel: string): number;
export type DeliveryPromise = {
    estimatedDispatchAt: string;
    estimatedDeliveryAt: string | null;
    safetyBufferHours: number;
};
export declare function estimateDispatchAndDelivery(input: {
    reservedAt: Date;
    deliverySlaHours: number | null | undefined;
    channel: string;
}): DeliveryPromise;
