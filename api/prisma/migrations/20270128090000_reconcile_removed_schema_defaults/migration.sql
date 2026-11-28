-- Reconcile physical database defaults with prisma/schema.prisma.
--
-- The existing 20270126090000_drop_company_defaults migration removed the
-- Prisma client defaults but was intentionally empty, assuming no database
-- defaults existed. The deployed migration history shows the older SQL
-- migrations did leave defaults in Postgres. Remove only those obsolete
-- defaults so inserts must supply an explicit tenant/company and Prisma's
-- @updatedAt client behavior remains the sole timestamp writer.
--
-- This changes column metadata only; existing rows are preserved.
ALTER TABLE "AssetCheckout" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Branch" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ChannelWebhookEvent" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ContextComment" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "CustomFieldDefinition" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ExceptionCase" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ExpiryAlert" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ImportBatch" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ImportRow" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Item" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ItemBundleComponent" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Location" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "MarketplaceConnector" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "PackSession" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "PriceList" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ReorderRule" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "ReturnRequest" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "SavedReport" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "SavedView" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "SerialNumber" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Shipment" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "StockCount" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "StockMovement" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "StockTakeCampaign" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Supplier" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "SupplierPriceBreak" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Tag" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "Transfer" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "UserNotification" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "WebhookDeliveryLog" ALTER COLUMN "companyId" DROP DEFAULT;
ALTER TABLE "WebhookSubscription" ALTER COLUMN "companyId" DROP DEFAULT;

ALTER TABLE "ControlPlaneApiKey" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneCompany" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneCompanyUser" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneConnector" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneDevice" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneFieldValue" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneImportProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneInvoice" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneKillSwitch" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneLedger" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneMeta" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneMutation" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlanePlatformUser" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneSession" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneUsage" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ControlPlaneWebhook" ALTER COLUMN "updatedAt" DROP DEFAULT;
