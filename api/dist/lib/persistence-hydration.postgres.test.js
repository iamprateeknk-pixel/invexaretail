"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
const repository_js_1 = require("./repository.js");
const tenant_scope_js_1 = require("./saas/tenant-scope.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
integration('startup hydration keeps default-company rows when the singleton profile id is default', async () => {
    const suffix = (0, node_crypto_1.randomUUID)();
    const locationId = `hydrate-location-${suffix}`;
    const userId = `hydrate-user-${suffix}`;
    await db_js_1.prisma.companyProfile.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default', name: 'InvexaRetail' },
    });
    await db_js_1.prisma.location.create({
        data: {
            id: locationId,
            code: `HYDRATE-${suffix}`,
            name: 'Hydration Regression Branch',
            type: 'store',
            companyId: tenant_scope_js_1.DEFAULT_COMPANY_ID,
        },
    });
    await db_js_1.prisma.user.create({
        data: {
            id: userId,
            name: 'Hydration Regression User',
            email: `${userId}@test.invexa.local`,
            passwordHash: 'not-used',
            role: 'ADMIN',
            assignedLocations: JSON.stringify([locationId]),
            companyId: tenant_scope_js_1.DEFAULT_COMPANY_ID,
        },
    });
    try {
        await (0, persistence_js_1.hydrateRepositoryFromDatabase)();
        strict_1.default.ok((0, repository_js_1.listLocations)().some((location) => location.id === locationId));
        strict_1.default.ok((0, repository_js_1.listUsers)().some((user) => user.id === userId));
    }
    finally {
        await db_js_1.prisma.user.deleteMany({ where: { id: userId, companyId: tenant_scope_js_1.DEFAULT_COMPANY_ID } });
        await db_js_1.prisma.location.deleteMany({ where: { id: locationId, companyId: tenant_scope_js_1.DEFAULT_COMPANY_ID } });
    }
});
