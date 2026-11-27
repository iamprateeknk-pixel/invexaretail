-- Completes 20270126090000_drop_company_defaults. That migration assumed
-- Prisma applies @default values only in the client and so shipped no DDL,
-- but `prisma migrate` had created them as real column DEFAULTs: every one of
-- these columns still defaulted to the phantom tenant 'default-company' in the
-- database, so a raw INSERT that omitted companyId kept landing there silently.
-- This drops those DEFAULTs, so a missing tenant now fails at insert time as
-- intended. No row is changed; existing data and its companyId values stay.
-- Every raw INSERT in src/ into these tables already supplies companyId.
-- The same pre-deploy audit as 20270126090000 applies.
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
