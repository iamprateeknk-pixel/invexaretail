// Blueprint P7 / §13.3 marketplace connectors: Amazon, Flipkart and a
// first-party website do not speak Invexa's order schema. This adapter
// turns each platform payload into the same {channel, externalReference,
// customerName, lines[]} shape `createOrderWithReservation` already
// consumes, so a connector is "something that POSTs /orders" rather than
// a parallel OMS.

export type ConnectorPlatform = 'AMAZON' | 'FLIPKART' | 'WEBSITE' | 'CUSTOM';

export type NormalizedConnectorOrder = {
  channel: string;
  externalReference: string;
  customerName: string | null;
  notes: string | null;
  lines: Array<{ sku: string; quantity: number }>;
};

export type ConnectorRecord = {
  id: string;
  name: string;
  platform: ConnectorPlatform;
  channel: string;
  webhookSecret: string;
  status: 'ACTIVE' | 'PAUSED';
  tenantId: string;
  createdAt: string;
  lastIngestedAt: string | null;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asQuantity(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pushLine(lines: Array<{ sku: string; quantity: number }>, sku: string, quantity: number) {
  if (!sku || quantity <= 0) return;
  const existing = lines.find((line) => line.sku === sku);
  if (existing) existing.quantity += quantity;
  else lines.push({ sku, quantity });
}

export function mapMarketplaceOrder(platform: ConnectorPlatform, payload: Record<string, unknown>): NormalizedConnectorOrder {
  const lines: Array<{ sku: string; quantity: number }> = [];

  if (platform === 'AMAZON') {
    const amazonOrder = (payload.AmazonOrderId ?? payload.amazonOrderId ?? payload.orderId) as unknown;
    const items = Array.isArray(payload.OrderItems) ? payload.OrderItems : Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      pushLine(lines, asString(row.SellerSKU ?? row.sku ?? row.ASIN), asQuantity(row.QuantityOrdered ?? row.quantity));
    }
    return {
      channel: 'AMAZON',
      externalReference: asString(amazonOrder),
      customerName: asString(payload.BuyerName ?? payload.customerName) || null,
      notes: asString(payload.MarketplaceId) || null,
      lines,
    };
  }

  if (platform === 'FLIPKART') {
    const orderId = payload.orderId ?? payload.orderID ?? payload.shipmentId;
    const items = Array.isArray(payload.orderItems) ? payload.orderItems : Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      pushLine(lines, asString(row.sku ?? row.fsn ?? row.productId), asQuantity(row.quantity ?? row.qty));
    }
    return {
      channel: 'FLIPKART',
      externalReference: asString(orderId),
      customerName: asString(payload.customerName ?? payload.buyerName) || null,
      notes: asString(payload.orderDate) || null,
      lines,
    };
  }

  const items = Array.isArray(payload.lines) ? payload.lines : Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    pushLine(lines, asString(row.sku ?? row.itemCode ?? row.code), asQuantity(row.quantity ?? row.qty));
  }
  return {
    channel: platform === 'WEBSITE' ? 'WEBSTORE' : asString(payload.channel) || 'CUSTOM',
    externalReference: asString(payload.externalReference ?? payload.orderId ?? payload.id),
    customerName: asString(payload.customerName ?? payload.customer) || null,
    notes: asString(payload.notes) || null,
    lines,
  };
}

export function validateNormalizedOrder(order: NormalizedConnectorOrder): string | null {
  if (!order.externalReference) return 'Marketplace order is missing an external reference.';
  if (!order.lines.length) return 'Marketplace order has no order lines.';
  return null;
}

const connectors: ConnectorRecord[] = [];

export function resetConnectors(): void {
  connectors.length = 0;
}

export function listConnectors(tenantId?: string): ConnectorRecord[] {
  return connectors.filter((row) => !tenantId || row.tenantId === tenantId).map((row) => ({ ...row }));
}

export function createConnector(input: {
  name: string;
  platform: ConnectorPlatform;
  channel?: string;
  webhookSecret: string;
  tenantId: string;
}): ConnectorRecord {
  const record: ConnectorRecord = {
    id: `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    platform: input.platform,
    channel: input.channel?.trim() || input.platform,
    webhookSecret: input.webhookSecret,
    status: 'ACTIVE',
    tenantId: input.tenantId,
    createdAt: new Date().toISOString(),
    lastIngestedAt: null,
  };
  connectors.push(record);
  return { ...record };
}

export function findConnector(id: string): ConnectorRecord | undefined {
  return connectors.find((row) => row.id === id);
}

export function markConnectorIngested(id: string): void {
  const row = connectors.find((entry) => entry.id === id);
  if (row) row.lastIngestedAt = new Date().toISOString();
}

export function verifyConnectorSignature(secret: string, payload: string, signature: string | undefined): boolean {
  if (!secret) return false;
  if (!signature) return false;
  const expected = `sha256=${require('node:crypto').createHmac('sha256', secret).update(payload).digest('hex')}`;
  if (expected.length !== signature.length) return false;
  return require('node:crypto').timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
