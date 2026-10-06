-- Phase 6: indexes for hot queries that were sequential scans, chosen from
-- EXPLAIN ANALYZE on a 180,000-row StockLedger / 60,000-row Transfer dataset
-- (docs/phase6-performance-deploy.md). Additive only (CREATE INDEX).
--   StockLedger(locationId, itemId)         stock list for one location:   19.6 ms -> 1.8 ms
--   Transfer(destinationLocationId, status) purchase-plan in-transit:       6.3 ms -> 0.09 ms
--   Transfer(sourceLocationId, createdAt)   transfers from a source, newest first: 4.0 ms -> 0.12 ms
--   Lot(expiryDate)                         expiry sweep range scan:        1.5 ms -> 0.4 ms
-- A Transfer(companyId, status) index was tried and dropped: the planner gained
-- only 7.7 -> 6.0 ms because a third of the rows match, so it was not worth its write cost.
CREATE INDEX "StockLedger_locationId_itemId_idx" ON "StockLedger"("locationId", "itemId");
CREATE INDEX "Transfer_destinationLocationId_status_idx" ON "Transfer"("destinationLocationId", "status");
CREATE INDEX "Transfer_sourceLocationId_createdAt_idx" ON "Transfer"("sourceLocationId", "createdAt");
CREATE INDEX "Lot_expiryDate_idx" ON "Lot"("expiryDate");
