"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const audit_js_1 = require("../lib/audit.js");
const channel_ingest_js_1 = require("../lib/channel-ingest.js");
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
// Week 15: signed marketplace webhook, extracted out of index.ts into its own
// router so it is testable. Deliberately unauthenticated by bearer token: the
// HMAC signature over the payload, keyed by the connector's secret, is the
// credential.
const router = (0, express_1.Router)();
router.post('/webhooks/marketplaces/:connectorId', async (req, res) => {
    const receivedAt = new Date().toISOString();
    let eventLog = null;
    let audit = { connectorId: String(req.params.connectorId ?? ''), receivedAt };
    const finish = async (state, orderId, error) => {
        if (!eventLog)
            return;
        const { prisma } = await import('../lib/db.js');
        await prisma.channelWebhookEvent.update({
            where: eventLog.key,
            data: { state, orderId: orderId ?? null, error: error ?? null, processedAt: new Date() },
        }).catch(() => undefined);
    };
    const record = (outcome, orderId) => {
        (0, audit_js_1.recordAudit)({
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
        audit = { ...audit, provider: connector.platform, payloadChecksum: (0, channel_ingest_js_1.payloadChecksum)(raw) };
        const signature = typeof req.headers['x-invexa-signature'] === 'string' ? req.headers['x-invexa-signature'] : '';
        if (!verifyConnectorSignature(connector.webhookSecret, raw, signature)) {
            record('REJECTED_SIGNATURE');
            res.status(401).json({ message: 'Invalid connector signature.' });
            return;
        }
        const mapped = mapMarketplaceOrder(connector.platform, req.body ?? {});
        audit = { ...audit, externalReference: mapped.externalReference };
        const invalid = validateNormalizedOrder(mapped);
        if (invalid) {
            record('REJECTED_INVALID');
            res.status(400).json({ message: invalid });
            return;
        }
        // Durable event log (database mode): the (connector, event id) unique constraint
        // recognises a replayed delivery - even one whose order was created by another
        // process - and ties provider event -> order for traceability.
        const eventId = (typeof req.headers['x-invexa-event-id'] === 'string' && req.headers['x-invexa-event-id'].trim())
            || mapped.externalReference || String(audit.payloadChecksum);
        const companyId = connector.tenantId;
        if (databaseEnabled) {
            const key = { connectorId_eventId: { connectorId: connector.id, eventId } };
            const prior = await prisma.channelWebhookEvent.findUnique({ where: key });
            if (prior?.state === 'PROCESSED') {
                record('DUPLICATE', prior.orderId ?? undefined);
                res.status(200).json({ duplicate: true, order: prior.orderId ? { id: prior.orderId } : null });
                return;
            }
            if (prior?.state === 'RECEIVED') {
                res.status(409).json({ message: 'This event is already being processed.' });
                return;
            }
            try {
                if (prior)
                    await prisma.channelWebhookEvent.update({ where: key, data: { state: 'RECEIVED', error: null, payloadChecksum: String(audit.payloadChecksum) } });
                else
                    await prisma.channelWebhookEvent.create({ data: { connectorId: connector.id, companyId, provider: connector.platform, eventId, payloadChecksum: String(audit.payloadChecksum) } });
            }
            catch (error) {
                if (error?.code === 'P2002') {
                    res.status(409).json({ message: 'This event is already being processed.' });
                    return;
                }
                throw error;
            }
            eventLog = { key, companyId };
        }
        // Everything the order resolves - SKUs and fulfilment locations - must belong
        // to the connector's own company. Previously both lookups were unscoped, so a
        // connector could match another company's items and reserve its stock.
        const lines = [];
        for (const line of mapped.lines) {
            const item = databaseEnabled
                ? await prisma.item.findFirst({ where: { companyId, OR: [{ code: line.sku }, { id: line.sku }] } })
                : listItems().find((entry) => (entry.code === line.sku || entry.id === line.sku) && (0, channel_ingest_js_1.ownedByConnectorCompany)((0, tenant_scope_js_1.ownerOfItem)(entry.id), companyId));
            if (item)
                lines.push({ itemId: item.id, quantity: line.quantity });
        }
        if (!lines.length) {
            record('REJECTED_NO_SKU_MATCH');
            await finish('REJECTED', undefined, 'No matching SKUs');
            res.status(409).json({ message: 'No matching SKUs for this marketplace order.' });
            return;
        }
        const locations = databaseEnabled
            ? await prisma.location.findMany({ where: { status: 'ACTIVE', companyId }, select: { id: true, name: true, type: true } })
            : listLocations()
                .filter((location) => (0, channel_ingest_js_1.ownedByConnectorCompany)((0, tenant_scope_js_1.ownerOfLocation)(location.id), companyId))
                .map((location) => ({ id: location.id, name: location.name, type: location.type }));
        const order = await createOrderWithReservation({
            channel: mapped.channel,
            externalReference: mapped.externalReference,
            customerName: mapped.customerName,
            notes: mapped.notes,
            createdById: databaseEnabled ? await (0, channel_ingest_js_1.ensureConnectorActor)(prisma, companyId) : 'connector',
            companyId,
            allowSplit: true,
            candidateLocations: locations.map((location) => ({ locationId: location.id, locationName: location.name, locationType: location.type })),
            lines,
        });
        markConnectorIngested(connector.id);
        await finish('PROCESSED', order.id);
        record(order.duplicate ? 'DUPLICATE' : 'CREATED', order.id);
        res.status(order.duplicate ? 200 : 201).json({ order, duplicate: Boolean(order.duplicate) });
    }
    catch (error) {
        record('FAILED');
        await finish('FAILED', undefined, error instanceof Error ? error.message : 'Unable to ingest marketplace order.');
        res.status(400).json({ message: error instanceof Error ? error.message : 'Unable to ingest marketplace order.' });
    }
});
exports.default = router;
