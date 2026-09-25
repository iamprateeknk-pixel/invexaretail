"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// ADR-002 negative coverage for count recommendations and evidence gates.
// A real Item/Location/rule belonging to company A must behave as absent
// when the same identifiers are evaluated under company B.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const count_tolerance_js_1 = require("./count-tolerance.js");
const evidence_rules_js_1 = require("./evidence-rules.js");
const integration = process.env.TEST_DATABASE_URL ? node_test_1.default : node_test_1.default.skip;
async function fixture() {
    const companyId = `rule-tenant-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const userId = `rule-user-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: {
            id: userId,
            name: 'Rule tenant user',
            email: `${userId}@test.invexa.local`,
            passwordHash: 'not-a-real-hash',
            role: 'ADMIN',
            assignedLocations: '[]',
            companyId,
        },
    });
    const item = await db_js_1.prisma.item.create({
        data: { code: `RULE-${(0, node_crypto_1.randomUUID)()}`, name: 'Rule item', category: 'HIGH_VALUE', companyId },
    });
    const location = await db_js_1.prisma.location.create({
        data: { code: `RULE-LOC-${(0, node_crypto_1.randomUUID)()}`, name: 'Rule location', type: 'STORE', companyId },
    });
    return {
        ctx: { companyId, tenantId: 'tenant-invexa', userId, role: 'ADMIN' },
        itemId: item.id,
        locationId: location.id,
    };
}
integration('count recommendations ignore another company item, counts and tolerance rules', async () => {
    const owner = await fixture();
    const other = await fixture();
    await db_js_1.prisma.toleranceRule.create({
        data: { label: 'Owner rule', percentThreshold: 1, active: true, createdById: owner.ctx.userId },
    });
    const hidden = await (0, count_tolerance_js_1.getCountRecommendation)(other.ctx, {
        itemId: owner.itemId,
        locationId: owner.locationId,
        bookQty: 10,
        physicalQty: 8,
    });
    strict_1.default.equal(hidden, null);
    const own = await (0, count_tolerance_js_1.getCountRecommendation)(owner.ctx, {
        itemId: owner.itemId,
        locationId: owner.locationId,
        bookQty: 10,
        physicalQty: 8,
    });
    strict_1.default.equal(own?.recommendRecount, true);
    strict_1.default.equal(own?.reason.includes('Owner rule'), true);
});
integration('evidence gates ignore another company item and evidence rules', async () => {
    const owner = await fixture();
    const other = await fixture();
    await db_js_1.prisma.evidenceRule.create({
        data: {
            label: 'Owner damage rule',
            triggerType: 'TRANSFER_RECEIVE_DAMAGE',
            quantityThreshold: 1,
            active: true,
            createdById: owner.ctx.userId,
        },
    });
    const input = {
        transferId: `transfer-${(0, node_crypto_1.randomUUID)()}`,
        triggerType: 'TRANSFER_RECEIVE_DAMAGE',
        itemId: owner.itemId,
        branchId: null,
        damagedQty: 5,
    };
    strict_1.default.deepEqual(await (0, evidence_rules_js_1.requireEvidenceForDamage)(other.ctx, input), { blocked: false });
    const own = await (0, evidence_rules_js_1.requireEvidenceForDamage)(owner.ctx, input);
    strict_1.default.equal(own.blocked, true);
    if (own.blocked)
        strict_1.default.match(own.reason, /Owner damage rule/);
});
