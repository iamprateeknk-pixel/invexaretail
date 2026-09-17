"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provisionOperationalTenant = provisionOperationalTenant;
const persistence_js_1 = require("../persistence.js");
const enterprise_repository_js_1 = require("../enterprise-repository.js");
const repository_js_1 = require("../repository.js");
const control_plane_js_1 = require("./control-plane.js");
const tenant_scope_js_1 = require("./tenant-scope.js");
async function provisionOperationalTenant(input) {
    if ((0, enterprise_repository_js_1.findUserByEmail)(input.admin.email)) {
        throw new control_plane_js_1.ControlPlaneError('Email already in use', 'EMAIL_IN_USE', 409);
    }
    const location = {
        id: `loc-${input.companyId}-main`,
        name: `${input.companyName} Store`,
        type: 'store',
    };
    const code = `STORE-${input.companyId.slice(-6).toUpperCase()}`;
    await (0, persistence_js_1.persistLocationCreate)(location, code, input.companyId);
    (0, tenant_scope_js_1.registerLocationCompany)(location.id, input.companyId);
    if (!repository_js_1.locations.some((row) => row.id === location.id)) {
        repository_js_1.locations.push(location);
    }
    (0, enterprise_repository_js_1.createEnhancedUser)({
        id: input.admin.id,
        companyId: input.companyId,
        email: input.admin.email,
        name: input.admin.name,
        role: 'ADMIN',
        branchIds: [],
        locationIds: [location.id],
        passwordHash: input.admin.passwordHash,
        status: 'active',
    });
    if (!repository_js_1.users.some((row) => row.id === input.admin.id)) {
        repository_js_1.users.push({
            id: input.admin.id,
            email: input.admin.email,
            name: input.admin.name,
            role: 'ADMIN',
            assignedLocationIds: [location.id],
        });
    }
    await (0, persistence_js_1.persistEnterpriseUser)({
        id: input.admin.id,
        name: input.admin.name,
        email: input.admin.email,
        passwordHash: input.admin.passwordHash,
        role: 'ADMIN',
        locationIds: [location.id],
        companyId: input.companyId,
    });
    return { location };
}
