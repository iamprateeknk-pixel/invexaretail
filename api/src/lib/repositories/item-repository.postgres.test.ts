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
import { findItemById, requireItemById, assertItemOwnedByTenant, ItemNotFoundError } from './item-repository.js';
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
