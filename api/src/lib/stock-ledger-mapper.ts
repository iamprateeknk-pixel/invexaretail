// One place that turns a StockLedger row into the StockLedgerRecord the API
// serves. Used by snapshot hydration (lib/persistence.ts) and by the
// database-first stock repository, so the two cannot drift apart — the same
// arrangement as item-record-mapper.ts / count-record-mapper.ts.
//
// Phase 5 (R1/R4): the mapper carries ALL of the projection's buckets.
// Before this, hydration mapped only onHand/quarantine/version, so every
// snapshot-fed screen in database mode reported reserved as 0 and
// overstated availability (phase5 plan §2.5c).
import type { Prisma } from '@prisma/client';
import type { StockLedgerRecord } from './repository.js';

type StockLedgerRow = {
  itemId: string;
  lotId: string;
  locationId: string;
  onHand: number | Prisma.Decimal;
  reserved: number | Prisma.Decimal;
  inTransit: number | Prisma.Decimal;
  quarantine: number | Prisma.Decimal;
  damaged: number | Prisma.Decimal;
  version: number;
};

export function ledgerRowToRecord(row: StockLedgerRow): StockLedgerRecord {
  return {
    itemId: row.itemId,
    lotId: row.lotId,
    locationId: row.locationId,
    onHand: Number(row.onHand),
    reserved: Number(row.reserved),
    inTransit: Number(row.inTransit),
    quarantine: Number(row.quarantine),
    damaged: Number(row.damaged),
    version: row.version,
  };
}
