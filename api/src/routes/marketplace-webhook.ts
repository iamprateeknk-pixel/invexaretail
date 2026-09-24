import { Router, type Request, type Response } from 'express';
import { recordAudit } from '../lib/audit.js';
import { ownedByConnectorCompany, payloadChecksum, type ChannelEventAudit } from '../lib/channel-ingest.js';
import { ownerOfItem, ownerOfLocation } from '../lib/saas/tenant-scope.js';

// Week 15: signed marketplace webhook, extracted out of index.ts into its own
// router so it is testable. Deliberately unauthenticated by bearer token: the
// HMAC signature over the payload, keyed by the connector's secret, is the
// credential.
const router = Router();

router.post('/webhooks/marketplaces/:connectorId', async (req: Request, res: Response) => {
  const receivedAt = new Date().toISOString();
  let audit: Partial<ChannelEventAudit> = { connectorId: String(req.params.connectorId ?? ''), receivedAt };
  const record = (outcome: ChannelEventAudit['outcome'], orderId?: string) => {
    recordAudit({
      actorId: 'connector',
      actorRole: 'CONNECTOR',
      action: `CHANNEL_EVENT_${outcome}`,
      entityType: 'marketplace_connector',
      entityId: audit.connectorId ?? '',
      metadata: { ...audit, outcome, orderId },
    });
  };
  try {
    const { findConnector, mapMarketplaceOrder, markConnectorIngested, validateNormalizedOrder, verifyConnectorSignature } = await import('../lib/connectors.js');
    const { prisma } = await import('../lib/db.js');
    const { databaseEnabled } = await import('../lib/persistence.js');
    const { createOrderWithReservation } = await import('../lib/orders.js');
    const { listItems, listLocations } = await import('../lib/repository.js');
    const connectorId = String(req.params.connectorId ?? '');
    const connector = findConnector(connectorId)
      ?? (databaseEnabled ? await prisma.marketplaceConnector.findUnique({ where: { id: connectorId } }) : null);
    if (!connector || connector.status === 'PAUSED') {
      res.status(404).json({ message: 'Connector not found.' });
      return;
    }
    const raw = JSON.stringify(req.body ?? {});
    audit = { ...audit, provider: connector.platform, payloadChecksum: payloadChecksum(raw) };
    const signature = typeof req.headers['x-invexa-signature'] === 'string' ? req.headers['x-invexa-signature'] : '';
    if (!verifyConnectorSignature(connector.webhookSecret, raw, signature)) {
      record('REJECTED_SIGNATURE');
      res.status(401).json({ message: 'Invalid connector signature.' });
      return;
    }
    const mapped = mapMarketplaceOrder(connector.platform as 'AMAZON' | 'FLIPKART' | 'WEBSITE' | 'CUSTOM', req.body ?? {});
    audit = { ...audit, externalReference: mapped.externalReference };
    const invalid = validateNormalizedOrder(mapped);
    if (invalid) {
      record('REJECTED_INVALID');
      res.status(400).json({ message: invalid });
      return;
    }
    // Everything the order resolves - SKUs and fulfilment locations - must belong
    // to the connector's own company. Previously both lookups were unscoped, so a
    // connector could match another company's items and reserve its stock.
    const companyId = connector.tenantId;
    const lines = [];
    for (const line of mapped.lines) {
      const item = databaseEnabled
        ? await prisma.item.findFirst({ where: { companyId, OR: [{ code: line.sku }, { id: line.sku }] } })
        : listItems().find((entry) => (entry.code === line.sku || entry.id === line.sku) && ownedByConnectorCompany(ownerOfItem(entry.id), companyId));
      if (item) lines.push({ itemId: item.id, quantity: line.quantity });
    }
    if (!lines.length) {
      record('REJECTED_NO_SKU_MATCH');
      res.status(409).json({ message: 'No matching SKUs for this marketplace order.' });
      return;
    }
    const locations = databaseEnabled
      ? await prisma.location.findMany({ where: { status: 'ACTIVE', companyId }, select: { id: true, name: true, type: true } })
      : listLocations()
        .filter((location) => ownedByConnectorCompany(ownerOfLocation(location.id), companyId))
        .map((location) => ({ id: location.id, name: location.name, type: location.type }));
    const order = await createOrderWithReservation({
      channel: mapped.channel,
      externalReference: mapped.externalReference,
      customerName: mapped.customerName,
      notes: mapped.notes,
      createdById: 'connector',
      companyId,
      allowSplit: true,
      candidateLocations: locations.map((location) => ({ locationId: location.id, locationName: location.name, locationType: location.type })),
      lines,
    });
    markConnectorIngested(connector.id);
    record(order.duplicate ? 'DUPLICATE' : 'CREATED', order.id);
    res.status(order.duplicate ? 200 : 201).json({ order, duplicate: Boolean(order.duplicate) });
  } catch (error) {
    record('FAILED');
    res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to ingest marketplace order.' });
  }
});

export default router;
