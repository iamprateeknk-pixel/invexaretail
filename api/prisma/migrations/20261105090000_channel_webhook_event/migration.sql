-- Guide Week 15: durable record of every marketplace webhook delivery.
-- Additive only: a new table, no existing data touched.
CREATE TABLE "ChannelWebhookEvent" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT 'default-company',
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payloadChecksum" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "orderId" TEXT,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelWebhookEvent_connectorId_eventId_key" ON "ChannelWebhookEvent"("connectorId", "eventId");
CREATE INDEX "ChannelWebhookEvent_companyId_receivedAt_idx" ON "ChannelWebhookEvent"("companyId", "receivedAt");
CREATE INDEX "ChannelWebhookEvent_orderId_idx" ON "ChannelWebhookEvent"("orderId");
