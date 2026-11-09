-- ULTRA P2: the SaaS control plane's system of record becomes one row per
-- record instead of the single ControlPlaneState JSON blob. The blob was
-- loaded once at startup and rewritten whole on every save, so two
-- replicas held two truths, a kill switch set on one replica kept serving
-- on the other, and concurrent saves silently dropped each other's state
-- (last-writer-wins on the whole document). These tables hold exactly the
-- collections the snapshot serialised; the row layer round-trips the
-- snapshot, so the in-memory services keep working unchanged.
--
-- Additive only: no existing table or row is touched. ControlPlaneState is
-- NOT dropped: on first boot after this migration the application imports
-- the blob into these tables once (if they are empty), then stops writing
-- the blob. The blob row stays as a rollback source.
--
-- PRE-DEPLOY NOTE (deploy-time, not code): the migration must be applied
-- before the build containing the row layer boots (Railway preDeploy runs
-- `prisma migrate deploy`). If the tables are missing at boot, hydration
-- fails soft with a warning and the plane serves its in-memory seed, as it
-- does today when ControlPlaneState is absent. That fallback is degraded
-- (replicas diverge) and must not be relied on in production.
CREATE TABLE "ControlPlaneCompany" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "primaryAdminId" TEXT,
    "createdAt" TEXT NOT NULL,
    "entitlements" JSONB NOT NULL,
    "limitOverrides" JSONB NOT NULL,
    "billing" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneCompany_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ControlPlanePlatformUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlanePlatformUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ControlPlanePlatformUser_email_key" ON "ControlPlanePlatformUser"("email");

CREATE TABLE "ControlPlaneCompanyUser" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isPrimaryAdmin" BOOLEAN NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneCompanyUser_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneCompanyUser_companyId_idx" ON "ControlPlaneCompanyUser"("companyId");

CREATE TABLE "ControlPlaneSession" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneSession_companyId_idx" ON "ControlPlaneSession"("companyId");

CREATE TABLE "ControlPlaneApiKey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ControlPlaneApiKey_hash_key" ON "ControlPlaneApiKey"("hash");
CREATE INDEX "ControlPlaneApiKey_companyId_idx" ON "ControlPlaneApiKey"("companyId");

CREATE TABLE "ControlPlaneKillSwitch" (
    "featureKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneKillSwitch_pkey" PRIMARY KEY ("featureKey")
);

CREATE TABLE "ControlPlaneUsage" (
    "companyId" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneUsage_pkey" PRIMARY KEY ("companyId", "meter")
);

CREATE TABLE "ControlPlaneWebhook" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "signingSecret" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneWebhook_companyId_idx" ON "ControlPlaneWebhook"("companyId");

CREATE TABLE "ControlPlaneConnector" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneConnector_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneConnector_companyId_idx" ON "ControlPlaneConnector"("companyId");

CREATE TABLE "ControlPlaneDevice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneDevice_companyId_idx" ON "ControlPlaneDevice"("companyId");

CREATE TABLE "ControlPlaneInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TEXT NOT NULL,
    "paidAt" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneInvoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneInvoice_companyId_idx" ON "ControlPlaneInvoice"("companyId");

CREATE TABLE "ControlPlaneConfig" (
    "versionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneConfig_pkey" PRIMARY KEY ("versionId", "kind")
);

CREATE INDEX "ControlPlaneConfig_companyId_kind_idx" ON "ControlPlaneConfig"("companyId", "kind");

CREATE TABLE "ControlPlaneAudit" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT,
    "sessionId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "timestamp" TEXT NOT NULL,

    CONSTRAINT "ControlPlaneAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneAudit_companyId_timestamp_idx" ON "ControlPlaneAudit"("companyId", "timestamp");

CREATE TABLE "ControlPlaneMutation" (
    "mutationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TEXT NOT NULL,
    "serverAckAt" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneMutation_pkey" PRIMARY KEY ("mutationId")
);

CREATE INDEX "ControlPlaneMutation_companyId_idx" ON "ControlPlaneMutation"("companyId");

CREATE TABLE "ControlPlaneFieldValue" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneFieldValue_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ControlPlaneLedger" (
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneLedger_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ControlPlaneImportProfile" (
    "key" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneImportProfile_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "ControlPlaneOutbox" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "ControlPlaneOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ControlPlaneOutbox_createdAt_idx" ON "ControlPlaneOutbox"("createdAt");

CREATE TABLE "ControlPlaneMeta" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlPlaneMeta_pkey" PRIMARY KEY ("key")
);
