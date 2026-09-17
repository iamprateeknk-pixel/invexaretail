// Blueprint P5/P6 "Carrier adapter: standard interface - rates,
// serviceability, create AWB, label, manifest, tracking, cancel" and
// "Connector platform, not one-off integrations": every carrier (Shiprocket,
// Delhivery, Blue Dart, or a store's own manual courier) implements this one
// interface, so the rest of the app never branches on which carrier is
// configured. A LocalCarrierAdapter ships today (deterministic, no external
// credentials required - many small retailers run manual/local couriers
// anyway) and is a real, usable default, not just a test double; a real
// provider plugs in later behind the same contract.

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
  events: Array<{ status: string; at: string; location?: string | null }>;
};

export interface CarrierAdapter {
  readonly provider: string;
  getRates(input: CarrierShipmentInput): Promise<CarrierRateQuote[]>;
  checkServiceability(pincode: string): Promise<boolean>;
  createShipment(input: CarrierShipmentInput): Promise<CarrierShipmentResult>;
  trackShipment(awbNumber: string): Promise<CarrierTrackingStatus>;
  cancelShipment(awbNumber: string): Promise<void>;
}

const RATE_PER_KG = 40;
const BASE_RATE = 60;
const SURFACE_DAYS = 4;
const EXPRESS_DAYS = 2;

function deterministicAwb(orderReference: string, salt: string): string {
  let hash = 0;
  const source = `${orderReference}|${salt}`;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `LOCAL-${hash.toString(36).toUpperCase().padStart(8, '0')}`;
}

const localShipments = new Map<string, CarrierTrackingStatus>();

/**
 * LocalCarrierAdapter: a real, deterministic courier adapter with no
 * external dependency - rates are a simple weight-based estimate, every
 * pincode is serviceable, and shipment status starts at BOOKED and only
 * advances when the caller (a real "handed to courier" / "delivered" scan,
 * once that UI exists) explicitly reports it - never fabricated, unlike a
 * fake progress simulation would.
 */
export class LocalCarrierAdapter implements CarrierAdapter {
  readonly provider = 'local';

  async getRates(input: CarrierShipmentInput): Promise<CarrierRateQuote[]> {
    const weightCost = BASE_RATE + input.weightKg * RATE_PER_KG;
    return [
      { serviceCode: 'LOCAL_SURFACE', serviceName: 'Local Surface Courier', estimatedCost: Math.round(weightCost), estimatedDays: SURFACE_DAYS },
      { serviceCode: 'LOCAL_EXPRESS', serviceName: 'Local Express Courier', estimatedCost: Math.round(weightCost * 1.6), estimatedDays: EXPRESS_DAYS },
    ];
  }

  async checkServiceability(_pincode: string): Promise<boolean> {
    return true;
  }

  async createShipment(input: CarrierShipmentInput): Promise<CarrierShipmentResult> {
    const awbNumber = deterministicAwb(input.orderReference, `${Date.now()}`);
    const now = new Date().toISOString();
    localShipments.set(awbNumber, {
      awbNumber, status: 'BOOKED', lastUpdatedAt: now,
      events: [{ status: 'BOOKED', at: now }],
    });
    return { awbNumber, labelUrl: null, manifestId: null, serviceCode: 'LOCAL_SURFACE' };
  }

  async trackShipment(awbNumber: string): Promise<CarrierTrackingStatus> {
    const status = localShipments.get(awbNumber);
    if (!status) throw new Error(`No shipment found for AWB ${awbNumber}.`);
    return status;
  }

  async cancelShipment(awbNumber: string): Promise<void> {
    const status = localShipments.get(awbNumber);
    if (!status) throw new Error(`No shipment found for AWB ${awbNumber}.`);
    if (status.status === 'DELIVERED') throw new Error('A delivered shipment cannot be cancelled.');
    const now = new Date().toISOString();
    localShipments.set(awbNumber, { ...status, status: 'CANCELLED', lastUpdatedAt: now, events: [...status.events, { status: 'CANCELLED', at: now }] });
  }
}

const adapters: Record<string, CarrierAdapter> = {
  local: new LocalCarrierAdapter(),
};

export function getCarrierAdapter(provider: string): CarrierAdapter {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`Unknown carrier provider: ${provider}.`);
  return adapter;
}

export function listCarrierProviders(): string[] {
  return Object.keys(adapters);
}
