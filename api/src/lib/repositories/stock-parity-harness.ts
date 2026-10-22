// Phase 5 (DB-first stock reads, R1/R4) — step 0 parity harness.
//
// docs/db-first-reads-plan.md's gate demanded a reusable memory-vs-Postgres
// parity helper before any stock slice converted: seed one fixture in
// Postgres, then compare what the hydrated snapshot serves against what the
// DB-first repository functions return over the SAME rows, and report any
// difference as a field path instead of a bare "not equal". Every Phase 5
// stock suite (stock-repository, and the characterization pins in
// routes/stock-characterization.postgres.test.ts) seeds through here so the
// fixture — and therefore the expected numbers — exists exactly once.
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import type { TenantContext } from '../tenant-context.js';

export function stockParityCtx(companyId: string): TenantContext {
  return { companyId, tenantId: 'tenant-invexa', userId: 'stock-parity', role: 'ADMIN' };
}

export type StockParityFixture = {
  companyA: string;
  companyB: string;
  /** Company A's store: two ledger rows (one fully bucketed, one all-zero) and one BinStock row. */
  locationA: string;
  /** Company A's warehouse: a ledger row with onHand > 0 but NO BinStock rows — the §2.5b fallback case. */
  locationA2: string;
  /** Company B's store: one ledger row; must never leak into company A's reads. */
  locationB: string;
  itemA1: string;
  lotA1: string;
  itemA2: string;
  lotA2: string;
  itemB1: string;
  lotB1: string;
  binA: string;
};

/**
 * The fixture's ledger rows, in canonical form (see canonicalLedgerRows):
 *
 *   company A @ locationA : itemA1/lotA1 onHand 10, reserved 4, inTransit 2, quarantine 1, damaged 1, version 3
 *                           itemA2/lotA2 all-zero, version 0
 *   company A @ locationA2: itemA1/lotA1 onHand 6, version 1 (no BinStock rows at this location)
 *   company B @ locationB : itemB1/lotB1 onHand 5, reserved 1, version 2
 *
 * plus one BinStock row at locationA (binA, itemA1/lotA1, onHand 10, reserved 4).
 */
export async function seedStockParityFixture(): Promise<StockParityFixture> {
  const suffix = randomUUID();
  const companyA = `stock-parity-a-${suffix}`;
  const companyB = `stock-parity-b-${suffix}`;
  await prisma.companyProfile.create({ data: { id: companyA, name: companyA } });
  await prisma.companyProfile.create({ data: { id: companyB, name: companyB } });

  const makeLocation = async (companyId: string, label: string, type = 'store') => {
    const id = `stock-parity-loc-${label}-${suffix}`;
    await prisma.location.create({ data: { id, code: id, name: `Parity ${label}`, type, companyId } });
    return id;
  };
  const makeItemWithLot = async (companyId: string, label: string) => {
    const itemId = `stock-parity-item-${label}-${suffix}`;
    await prisma.item.create({ data: { id: itemId, code: itemId, name: `Parity item ${label}`, unit: 'ea', companyId } });
    const lot = await prisma.lot.create({ data: { itemId, lotNo: `LOT-${label}-${suffix.slice(0, 8)}` } });
    return { itemId, lotId: lot.id };
  };

  const locationA = await makeLocation(companyA, 'a-store');
  const locationA2 = await makeLocation(companyA, 'a-warehouse', 'warehouse');
  const locationB = await makeLocation(companyB, 'b-store');
  const a1 = await makeItemWithLot(companyA, 'a1');
  const a2 = await makeItemWithLot(companyA, 'a2');
  const b1 = await makeItemWithLot(companyB, 'b1');

  const ledger = (companyId: string, itemId: string, lotId: string, locationId: string, buckets: Record<string, number>) =>
    prisma.stockLedger.create({ data: { companyId, itemId, lotId, locationId, ...buckets } });
  await ledger(companyA, a1.itemId, a1.lotId, locationA, { onHand: 10, reserved: 4, inTransit: 2, quarantine: 1, damaged: 1, version: 3 });
  await ledger(companyA, a2.itemId, a2.lotId, locationA, {});
  await ledger(companyA, a1.itemId, a1.lotId, locationA2, { onHand: 6, version: 1 });
  await ledger(companyB, b1.itemId, b1.lotId, locationB, { onHand: 5, reserved: 1, version: 2 });

  const binA = `BIN-PARITY-${suffix.slice(0, 8)}`;
  await prisma.binStock.create({
    data: { companyId: companyA, itemId: a1.itemId, lotId: a1.lotId, locationId: locationA, binId: binA, onHand: 10, reserved: 4 },
  });

  return {
    companyA, companyB, locationA, locationA2, locationB,
    itemA1: a1.itemId, lotA1: a1.lotId, itemA2: a2.itemId, lotA2: a2.lotId,
    itemB1: b1.itemId, lotB1: b1.lotId, binA,
  };
}

type LedgerRowLike = {
  itemId: string;
  lotId: string;
  locationId: string;
  onHand: unknown;
  quarantine: unknown;
  reserved?: unknown;
  inTransit?: unknown;
  damaged?: unknown;
  version?: unknown;
};

/**
 * One comparable shape for a stock row, whichever side produced it: Prisma
 * rows carry Decimals, snapshot records carry numbers, and — until Phase 5
 * step 1 — snapshot records carry no reserved/inTransit/damaged at all, which
 * canonicalises to null so the §2.5c divergence shows up as data, not as a
 * missing key. Sorted by (itemId, lotId, locationId): row order is not a
 * contract on either side (hydration has no orderBy), identity is.
 */
export function canonicalLedgerRows(rows: LedgerRowLike[]) {
  const num = (value: unknown) => (value === undefined || value === null ? null : Number(value));
  return rows
    .map((row) => ({
      itemId: row.itemId,
      lotId: row.lotId,
      locationId: row.locationId,
      onHand: num(row.onHand),
      reserved: num(row.reserved),
      inTransit: num(row.inTransit),
      quarantine: num(row.quarantine),
      damaged: num(row.damaged),
      version: num(row.version),
    }))
    .sort((a, b) => `${a.itemId}|${a.lotId}|${a.locationId}`.localeCompare(`${b.itemId}|${b.lotId}|${b.locationId}`));
}

/**
 * Deep-compares two JSON-shaped values and returns one human-readable entry
 * per difference ("$.items[2].reserved: expected 4, got 0"), so a parity
 * failure names the field that moved. An empty array means parity.
 */
export function diffJson(expected: unknown, actual: unknown, path = '$'): string[] {
  if (Object.is(expected, actual)) return [];
  const bothObjects = typeof expected === 'object' && expected !== null && typeof actual === 'object' && actual !== null;
  if (!bothObjects) return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    return [`${path}: expected ${Array.isArray(expected) ? 'an array' : 'an object'}, got ${Array.isArray(actual) ? 'an array' : 'an object'}`];
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const diffs: string[] = [];
    if (expected.length !== actual.length) diffs.push(`${path}: expected ${expected.length} entries, got ${actual.length}`);
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) {
      diffs.push(...diffJson(expected[i], actual[i], `${path}[${i}]`));
    }
    return diffs;
  }
  const expectedObj = expected as Record<string, unknown>;
  const actualObj = actual as Record<string, unknown>;
  const diffs: string[] = [];
  for (const key of [...new Set([...Object.keys(expectedObj), ...Object.keys(actualObj)])].sort()) {
    if (!(key in expectedObj)) diffs.push(`${path}.${key}: unexpected in actual`);
    else if (!(key in actualObj)) diffs.push(`${path}.${key}: missing in actual`);
    else diffs.push(...diffJson(expectedObj[key], actualObj[key], `${path}.${key}`));
  }
  return diffs;
}
