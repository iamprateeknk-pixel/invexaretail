-- Webhook subscriptions and their delivery log were global: any admin listed, paused or replayed
-- another company's hooks and payloads, and every event was delivered to every subscription.
-- Additive: new company column (existing rows stay with the single-company default), indexed.
ALTER TABLE "WebhookSubscription" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
ALTER TABLE "WebhookDeliveryLog" ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'default-company';
CREATE INDEX "WebhookSubscription_companyId_idx" ON "WebhookSubscription"("companyId");
CREATE INDEX "WebhookDeliveryLog_companyId_idx" ON "WebhookDeliveryLog"("companyId");
