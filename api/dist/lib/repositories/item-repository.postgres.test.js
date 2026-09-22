"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ADR-002 / Week 4: negative cross-tenant tests. Tenant A and Tenant B are
// real, separate companies; Tenant B's TenantContext is used to attempt
// reads, status changes and a permanent delete against an item that
// genuinely exists - just not for Tenant B. Every attempt must fail closed
// (same "not found" a missing item would give), never leak Tenant A's data
// and never mutate Tenant A's item. Skipped unless TEST_DATABASE_URL is set
// (see AGENTS.md "Required tests").
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("../db.js");
const item_repository_js_1 = require("./item-repository.js");
const item_master_service_js_1 = require("../item-master-service.js");
const repository_js_1 = require("../repository.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeCompany() {
    const id = `tenant-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id, name: id } });
    return id;
}
async function makeUser(companyId) {
    const id = `tenant-test-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
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
async function makeItem(companyId) {
    const id = `tenant-test-item-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.item.create({
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
function mirrorItemInMemory(id) {
    const record = { id, code: id, name: 'Cross-tenant test item', unit: 'ea', lots: [] };
    repository_js_1.items.push(record);
    return record;
}
async function ctxFor(companyId) {
    const userId = await makeUser(companyId);
    return { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' };
}
integration('Tenant B cannot read an item that belongs to Tenant A', async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const itemId = await makeItem(companyA);
    const ctxB = await ctxFor(companyB);
    strict_1.default.equal(await (0, item_repository_js_1.findItemById)(ctxB, itemId), null);
    await strict_1.default.rejects(() => (0, item_repository_js_1.requireItemById)(ctxB, itemId), item_repository_js_1.ItemNotFoundError);
    await strict_1.default.rejects(() => (0, item_repository_js_1.assertItemOwnedByTenant)(ctxB, itemId), item_repository_js_1.ItemNotFoundError);
    // Tenant A can, proving the block above is tenant-specific, not a bug that hides everything.
    const ctxA = await ctxFor(companyA);
    const own = await (0, item_repository_js_1.findItemById)(ctxA, itemId);
    strict_1.default.equal(own?.id, itemId);
});
integration('Tenant B cannot change the status of an item that belongs to Tenant A', async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const itemId = await makeItem(companyA);
    mirrorItemInMemory(itemId);
    const ctxB = await ctxFor(companyB);
    const ctxA = await ctxFor(companyA);
    await strict_1.default.rejects(() => (0, item_master_service_js_1.changeItemStatus)(ctxB, itemId, { status: 'ARCHIVED', reason: 'cross-tenant attempt' }), (error) => error instanceof Error && /not found/i.test(error.message));
    const stillActive = await db_js_1.prisma.item.findUnique({ where: { id: itemId } });
    strict_1.default.equal(stillActive?.status, 'ACTIVE');
    // Proves the rejection above is the tenant check, not an unrelated bug:
    // the legitimate owner can perform the exact same call.
    const result = await (0, item_master_service_js_1.changeItemStatus)(ctxA, itemId, { status: 'ARCHIVED', reason: 'legitimate' });
    strict_1.default.equal(result.changed, true);
});
integration('Tenant B cannot permanently delete an item that belongs to Tenant A', async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const itemId = await makeItem(companyA);
    mirrorItemInMemory(itemId);
    const ctxB = await ctxFor(companyB);
    await strict_1.default.rejects(() => (0, item_master_service_js_1.deleteItemPermanently)(ctxB, itemId), (error) => error instanceof Error && /not found/i.test(error.message));
    const stillThere = await db_js_1.prisma.item.findUnique({ where: { id: itemId } });
    strict_1.default.ok(stillThere, 'Tenant A\'s item must survive a wrong-tenant delete attempt');
    strict_1.default.equal(stillThere.companyId, companyA);
    // Proves the rejection above is the tenant check, not an unrelated bug:
    // the legitimate owner can perform the exact same call.
    const ctxA = await ctxFor(companyA);
    await (0, item_master_service_js_1.deleteItemPermanently)(ctxA, itemId);
    strict_1.default.equal(await db_js_1.prisma.item.findUnique({ where: { id: itemId } }), null);
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
    strict_1.default.ok(!list.some((item) => item.id === realItemId), 'Tenant A\'s item must not appear in Tenant B\'s listing');
});
