// Webhook subscription + delivery routes for operations-extension
// (Phase 4): extracted verbatim from operations-extension.ts; the
// composer mounts these routers at the clusters' original positions.
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { databaseEnabled } from '../lib/persistence.js';
import { encryptWebhookSecret, WebhookValidationError } from '../lib/webhook-events.js';
import { replayDelivery, retryDueDeliveries, WebhookReplayError } from '../lib/webhook-dispatcher.js';
import { createWebhookSubscription, listWebhookDeliveries, listWebhookSubscriptions, setWebhookSubscriptionStatus } from '../lib/webhook-store.js';
import { DEFAULT_COMPANY_ID } from '../lib/saas/tenant-scope.js';
import { requireAdmin } from './opext-shared.js';

const router = Router();

router.get('/webhook-subscriptions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!databaseEnabled) return res.json({ subscriptions: listWebhookSubscriptions(req.companyId ?? DEFAULT_COMPANY_ID) });
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID },
    select: { id: true, name: true, endpointUrl: true, events: true, status: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ subscriptions });
});

router.post('/webhook-subscriptions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const created = createWebhookSubscription({
      name: req.body.name,
      endpointUrl: req.body.endpointUrl,
      events: req.body.events,
      allowPrivate: !databaseEnabled,
      companyId: req.companyId ?? DEFAULT_COMPANY_ID,
    });
    if (databaseEnabled) {
      await prisma.webhookSubscription.create({
        data: {
          id: created.subscription.id,
          companyId: req.companyId ?? DEFAULT_COMPANY_ID,
          name: created.subscription.name,
          endpointUrl: created.subscription.endpointUrl,
          events: created.subscription.events,
          secretHash: createHash('sha256').update(created.signingSecret).digest('hex'),
          secretEncrypted: encryptWebhookSecret(created.signingSecret),
        },
        select: { id: true, name: true, endpointUrl: true, events: true, status: true, createdAt: true, updatedAt: true },
      });
    }
    return res.status(201).json(created);
  } catch (error) {
    const status = error instanceof WebhookValidationError ? error.status : 400;
    return res.status(status).json({ message: error instanceof Error ? error.message : 'Unable to create webhook.' });
  }
});

router.patch('/webhook-subscriptions/:id/status', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const subscription = setWebhookSubscriptionStatus(req.params.id, req.body.status, req.companyId ?? DEFAULT_COMPANY_ID);
    if (databaseEnabled) {
      await prisma.webhookSubscription.updateMany({
        where: { id: req.params.id, companyId: req.companyId ?? DEFAULT_COMPANY_ID },
        data: { status: req.body.status },
      }).catch(() => undefined);
    }
    return res.json({ subscription });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update webhook.';
    return res.status(message.includes('not found') ? 404 : 400).json({ message });
  }
});

export default router;

// The routes below were registered later in the original file, after
// clusters that live in other routers; they keep their own router so the
// composer can mount them at their original position. The bare block
// shadows `router` so the moved registrations stay byte-identical.
export const webhookDeliveriesRouter = Router();
{
  const router = webhookDeliveriesRouter;
router.get('/webhook-deliveries', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const memory = listWebhookDeliveries(100, req.companyId ?? DEFAULT_COMPANY_ID);
  if (!databaseEnabled) return res.json({ deliveries: memory });
  const persisted = await prisma.webhookDeliveryLog.findMany({ where: { companyId: req.companyId ?? DEFAULT_COMPANY_ID }, orderBy: { createdAt: 'desc' }, take: 100 });
  const seen = new Set(memory.map((row) => row.id));
  return res.json({
    deliveries: [
      ...memory,
      ...persisted.filter((row) => !seen.has(row.id)).map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      })),
    ].slice(0, 100),
  });
});

router.post('/webhook-deliveries/:id/replay', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const delivery = await replayDelivery(req.params.id, req.companyId ?? DEFAULT_COMPANY_ID);
    return res.json({ delivery });
  } catch (error) {
    if (error instanceof WebhookReplayError) return res.status(409).json({ message: error.message });
    return res.status(502).json({ message: error instanceof Error ? error.message : 'Unable to replay this delivery.' });
  }
});

// Manual trigger for visibility/testing, mirroring /orders/expire-reservations
// - the sweep also runs implicitly whenever this is called, but nothing
// currently schedules it automatically, so an operator (or a future cron)
// drives dead-letter recovery from here.
router.post('/webhook-deliveries/retry-due', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await retryDueDeliveries(req.companyId ?? DEFAULT_COMPANY_ID);
  return res.json(result);
});
}
