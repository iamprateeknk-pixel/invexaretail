"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Tenant and transition proof for the centralized status writers. Skipped
// unless TEST_DATABASE_URL is set; AGENTS.md requires a real Postgres
// negative test for every new tenant-scoped mutation.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const domain_policies_js_1 = require("./domain-policies.js");
const errors_js_1 = require("./errors.js");
const integration = process.env.TEST_DATABASE_URL ? node_test_1.default : node_test_1.default.skip;
async function makeCompanyFixture() {
    const companyId = `policy-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `policy-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: {
            id: userId,
            name: 'Policy test user',
            email: `${userId}@test.invexa.local`,
            passwordHash: 'not-a-real-hash',
            role: 'WAREHOUSE_PICKER',
            assignedLocations: '[]',
            companyId,
        },
    });
    const source = await db_js_1.prisma.location.create({
        data: { code: `src-${(0, node_crypto_1.randomUUID)()}`, name: 'Source', type: 'WAREHOUSE', companyId },
    });
    const destination = await db_js_1.prisma.location.create({
        data: { code: `dst-${(0, node_crypto_1.randomUUID)()}`, name: 'Destination', type: 'STORE', companyId },
    });
    return { companyId, userId, source, destination };
}
integration('transfer status mutation fails closed for another company and succeeds for the owner', async () => {
    const owner = await makeCompanyFixture();
    const other = await makeCompanyFixture();
    const transfer = await db_js_1.prisma.transfer.create({
        data: {
            sourceLocationId: owner.source.id,
            destinationLocationId: owner.destination.id,
            requestedById: owner.userId,
            companyId: owner.companyId,
            status: 'REQUESTED',
        },
    });
    await strict_1.default.rejects(() => (0, domain_policies_js_1.transitionTransferStatus)({
        entityId: transfer.id,
        companyId: other.companyId,
        to: 'PICKING',
        role: 'WAREHOUSE_PICKER',
        actorId: other.userId,
    }), (error) => (0, errors_js_1.isDomainError)(error) && error.code === 'NOT_FOUND');
    strict_1.default.equal((await db_js_1.prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status, 'REQUESTED');
    await (0, domain_policies_js_1.transitionTransferStatus)({
        entityId: transfer.id,
        companyId: owner.companyId,
        to: 'PICKING',
        role: 'WAREHOUSE_PICKER',
        actorId: owner.userId,
    });
    strict_1.default.equal((await db_js_1.prisma.transfer.findUniqueOrThrow({ where: { id: transfer.id } })).status, 'PICKING');
});
