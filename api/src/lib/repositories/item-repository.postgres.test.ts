// ADR-002 / Week 4: negative cross-tenant tests. Tenant A and Tenant B are
// real, separate companies; Tenant B's TenantContext is used to attempt
// reads, status changes and a permanent delete against an item that
// genuinely exists - just not for Tenant B. Every attempt must fail closed
// (same "not found" a missing item would give), never leak Tenant A's data
// and never mutate Tenant A's item. Skipped unless TEST_DATABASE_URL is set
// (see AGENTS.md "Required tests").
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { findItemById, requireItemById, assertItemOwnedByTenant, searchItems, ItemNotFoundError } from './item-repository.js';
import { changeItemStatus, deleteItemPermanently } from '../item-master-service.js';
import { items as memoryItems, type ItemRecord } from '../repository.js';
import type { TenantContext } from '../tenant-context.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

async function makeCompany(): Promise<string> {
  const id = `tenant-test-${randomUUID()}`;
  await prisma.companyProfile.create({ data: { id, name: id } });
  return id;
}

async function makeUser(companyId: string): Promise<string> {
  const id = `tenant-test-user-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id,
      name: 'Tenant Test User',
      email: `${id}@test.invexa.local`,
      passwordHash: 'not-a-real-hash',
      role: 'ADMIN',
      assignedLocations: '[]',
      companyId,
    },
  });
  return id;
}

async function makeItem(companyId: string): Promise<string> {
  const id = `tenant-test-item-${randomUUID()}`;
  await prisma.item.create({
    data: { id, code: id, name: 'Cross-tenant test item', unit: 'ea', companyId },
  });
  return id;
}

/**
 * changeItemStatus/deleteItemPermanently mutate the app's in-memory item
 * mirror (populated by hydrateRepositoryFromDatabase() in the real server,
 * which this isolated test does not run) in addition to the database. To
 * exercise the ownership *check* itself rather than tripping over an
 * unrelated "not hydrated" 404, mirror the row the same way a running
 * server would have.
 */
function mirrorItemInMemory(id: string): ItemRecord {
  const record: ItemRecord = { id, code: id, name: 'Cross-tenant test item', unit: 'ea', lots: [] };
  memoryItems.push(record);
  return record;
}

async function ctxFor(companyId: string): Promise<TenantContext> {
  const userId = await makeUser(companyId);
  return { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
}

integration('Tenant B cannot read an item that belongs to Tenant A', async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const itemId = await makeItem(companyA);
  const ctxB = await ctxFor(companyB);

  assert.equal(await findItemById(ctxB, itemId), null);
  await assert.rejects(() => requireItemById(ctxB, itemId), ItemNotFoundError);
  await assert.rejects(() => assertItemOwnedByTenant(ctxB, itemId), ItemNotFoundError);

  // Tenant A can, proving the block above is tenant-specific, not a bug that hides everything.
  const ctxA = await ctxFor(companyA);
  const own = await findItemById(ctxA, itemId);
  assert.equal(own?.id, itemId);
});

integration('Tenant B cannot change the status of an item that belongs to Tenant A', async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const itemId = await makeItem(companyA);
  mirrorItemInMemory(itemId);
  const ctxB = await ctxFor(companyB);
  const ctxA = await ctxFor(companyA);

  await assert.rejects(
    () => changeItemStatus(ctxB, itemId, { status: 'ARCHIVED', reason: 'cross-tenant attempt' }),
    (error: unknown) => error instanceof Error && /not found/i.test(error.message),
  );
  const stillActive = await prisma.item.findUnique({ where: { id: itemId } });
  assert.equal(stillActive?.status, 'ACTIVE');

  // Proves the rejection above is the tenant check, not an unrelated bug:
  // the legitimate owner can perform the exact same call.
  const result = await changeItemStatus(ctxA, itemId, { status: 'ARCHIVED', reason: 'legitimate' });
  assert.equal(result.changed, true);
});

integration('Tenant B cannot permanently delete an item that belongs to Tenant A', async () => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const itemId = await makeItem(companyA);
  mirrorItemInMemory(itemId);
  const ctxB = await ctxFor(companyB);

  await assert.rejects(
    () => deleteItemPermanently(ctxB, itemId),
    (error: unknown) => error instanceof Error && /not found/i.test(error.message),
  );

  const stillThere = await prisma.item.findUnique({ where: { id: itemId } });
  assert.ok(stillThere, 'Tenant A\'s item must survive a wrong-tenant delete attempt');
  assert.equal(stillThere!.companyId, companyA);

  // Proves the rejection above is the tenant check, not an unrelated bug:
  // the legitimate owner can perform the exact same call.
  const ctxA = await ctxFor(companyA);
  await deleteItemPermanently(ctxA, itemId);
  assert.equal(await prisma.item.findUnique({ where: { id: itemId } }), null);
});

integration('a guessed/observed real Tenant A id does not help Tenant B - the id alone is not a credential', async () => {
  // Same scenario as above but framed as the guide's "guessed relationships"
  // attack: an id is not secret (it can appear in URLs, exports, logs), so
  // knowing it must never be sufficient - only real ownership can be.
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const realItemId = await makeItem(companyA);
  const ctxB = await ctxFor(companyB);

  const list = await import('./item-repository.js').then((m) => m.listItems(ctxB));
  assert.ok(!list.some((item) => item.id === realItemId), 'Tenant A\'s item must not appear in Tenant B\'s listing');
});

// Week 10: searchItems' cursor-pagination suite (item search vertical
// slice's "5,000+ item pagination" mandatory verification).

integration('searchItems paginates 5,000+ items with a stable cursor, no duplicates, no gaps, and scoped to one tenant', async (t) => {
  const companyA = await makeCompany();
  const companyB = await makeCompany();
  const TOTAL = 5200;
  const run = randomUUID().slice(0, 8);

  const batchSize = 500;
  for (let start = 0; start < TOTAL; start += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, TOTAL - start) }, (_, i) => {
      const n = start + i;
      return { id: `bulk-item-${companyA}-${n}`, code: `BULK-${run}-${n.toString().padStart(6, '0')}`, name: `Bulk Item ${n}`, unit: 'ea', companyId: companyA };
    });
    await prisma.item.createMany({ data: batch });
  }
  // A handful of items belonging to a different tenant, to prove cross-tenant leakage never happens across pages.
  await prisma.item.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({ id: `bulk-item-${companyB}-${i}`, code: `OTHER-${run}-${i}`, name: `Other tenant item ${i}`, unit: 'ea', companyId: companyB })),
  });

  const started = Date.now();
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  const ctxA = await ctxFor(companyA);
  for (;;) {
    const page = await searchItems(ctxA, { cursor, limit: 100 });
    pages += 1;
    for (const item of page.items) {
      assert.equal(seen.has(item.id), false, `item ${item.id} was returned on more than one page`);
      seen.add(item.id);
      assert.ok(item.id.includes(companyA) || item.code.startsWith('BULK'), 'no cross-tenant item leaked into the page');
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    assert.ok(pages < 1000, 'pagination did not terminate - possible infinite loop');
  }
  const elapsedMs = Date.now() - started;
  t.diagnostic(`paginated ${seen.size} items across ${pages} pages in ${elapsedMs}ms`);

  assert.equal(seen.size, TOTAL, 'every item must be returned exactly once across all pages');
  assert.ok(elapsedMs < 30_000, `pagination over ${TOTAL} items took ${elapsedMs}ms - too slow for a search UI`);
});

integration('searchItems filters by free-text search across name and code', async () => {
  const companyId = await makeCompany();
  const run = randomUUID().slice(0, 8);
  await prisma.item.createMany({
    data: [
      { id: `srch-${randomUUID()}`, code: `RICE-5KG-${run}`, name: 'Basmati Rice 5kg', unit: 'bag', companyId },
      { id: `srch-${randomUUID()}`, code: `WHEAT-5KG-${run}`, name: 'Whole Wheat Flour 5kg', unit: 'bag', companyId },
      { id: `srch-${randomUUID()}`, code: `OIL-1L-${run}`, name: 'Sunflower Oil 1L', unit: 'bottle', companyId },
    ],
  });
  const ctx = await ctxFor(companyId);

  const byName = await searchItems(ctx, { search: 'rice' });
  assert.equal(byName.items.length, 1);
  assert.equal(byName.items[0].code, `RICE-5KG-${run}`);

  const byCode = await searchItems(ctx, { search: `wheat-5kg-${run}` });
  assert.equal(byCode.items.length, 1);
  assert.equal(byCode.items[0].name, 'Whole Wheat Flour 5kg');

  const noMatch = await searchItems(ctx, { search: 'nonexistent-xyz' });
  assert.equal(noMatch.items.length, 0);
  assert.equal(noMatch.nextCursor, null);
});

integration('searchItems clamps an excessive limit instead of erroring', async () => {
  const companyId = await makeCompany();
  const run = randomUUID().slice(0, 8);
  await prisma.item.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({ id: `clamp-${randomUUID()}`, code: `CLAMP-${run}-${i}`, name: `Clamp ${i}`, unit: 'ea', companyId })),
  });
  const page = await searchItems(await ctxFor(companyId), { limit: 100000 });
  assert.equal(page.items.length, 5);
});
