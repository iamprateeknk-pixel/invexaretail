export type CarrierRateQuote = {
    serviceCode: string;
    serviceName: string;
    estimatedCost: number;
    estimatedDays: number;
};
export type CarrierShipmentInput = {
    orderReference: string;
    originPincode: string;
    destinationPincode: string;
    weightKg: number;
    lengthCm?: number | null;
    widthCm?: number | null;
    heightCm?: number | null;
    codAmount?: number | null;
};
export type CarrierShipmentResult = {
    awbNumber: string;
    labelUrl: string | null;
    manifestId: string | null;
    serviceCode: string;
};
export type CarrierTrackingStatus = {
    awbNumber: string;
    status: 'BOOKED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'RTO';
    lastUpdatedAt: string;
    events: Array<{
        status: string;
        at: string;
        location?: string | null;
    }>;
};
export interface CarrierAdapter {
    readonly provider: string;
    getRates(input: CarrierShipmentInput): Promise<CarrierRateQuote[]>;
    checkServiceability(pincode: string): Promise<boolean>;
    createShipment(input: CarrierShipmentInput): Promise<CarrierShipmentResult>;
    trackShipment(awbNumber: string): Promise<CarrierTrackingStatus>;
    cancelShipment(awbNumber: string): Promise<void>;
}
/**
 * LocalCarrierAdapter: a real, deterministic courier adapter with no
 * external dependency - rates are a simple weight-based estimate, every
 * pincode is serviceable, and shipment status starts at BOOKED and only
 * advances when the caller (a real "handed to courier" / "delivered" scan,
 * once that UI exists) explicitly reports it - never fabricated, unlike a
 * fake progress simulation would.
 */
export declare class LocalCarrierAdapter implements CarrierAdapter {
    readonly provider = "local";
    getRates(input: CarrierShipmentInput): Promise<CarrierRateQuote[]>;
    checkServiceability(_pincode: string): Promise<boolean>;
    createShipment(input: CarrierShipmentInput): Promise<CarrierShipmentResult>;
    trackShipment(awbNumber: string): Promise<CarrierTrackingStatus>;
    cancelShipment(awbNumber: string): Promise<void>;
}
export declare function getCarrierAdapter(provider: string): CarrierAdapter;
export declare function listCarrierProviders(): string[];
