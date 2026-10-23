-- Marketplace order references are only unique within one company: two tenants can both receive
-- "SHOPIFY #1001". The old global (channel, externalReference) index made the second tenant's
-- order fail. Additive-safe: the new key is strictly weaker than the old one, so every existing
-- row satisfies it and no backfill is needed. NULL references stay unconstrained (NULLs are distinct).
DROP INDEX IF EXISTS "Order_channel_externalReference_key";
CREATE UNIQUE INDEX "Order_companyId_channel_externalReference_key" ON "Order"("companyId", "channel", "externalReference");
