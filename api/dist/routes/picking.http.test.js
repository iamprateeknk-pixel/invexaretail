"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const enterprise_repository_js_1 = require("../lib/enterprise-repository.js");
const seed_js_1 = require("../lib/seed.js");
const repository_js_1 = require("../lib/repository.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const core_js_1 = __importDefault(require("./core.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
function tokenFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return (0, otp_auth_js_1.generateJWT)(user.id, user.companyId);
}
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', core_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const call = async (method, path, token, body) => {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
    };
    try {
        await run(call);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
const unique = () => Math.random().toString(36).slice(2, 8).toUpperCase();
// A loose-KG item with three lots at wh-1: soonest-expiring 3 kg, later 2 kg, and a big lot with no expiry.
function looseItem() {
    const tag = unique();
    const item = (0, repository_js_1.createItemRecord)({ code: `LK-${tag}`, name: `Loose ${tag}`, unit: 'KG', pickMethod: 'ITEM_QTY_FIFO', allocationStrategy: 'FEFO', decimalQuantity: true });
    const lots = [
        (0, repository_js_1.ensureLotRecord)(item.id, `E1-${tag}`, '2027-06-01'),
        (0, repository_js_1.ensureLotRecord)(item.id, `E0-${tag}`, '2027-01-01'),
        (0, repository_js_1.ensureLotRecord)(item.id, `NX-${tag}`, null),
    ];
    const [late, soon, none] = lots;
    (0, repository_js_1.adjustStockLedger)(item.id, late.id, 'wh-1', 2);
    (0, repository_js_1.adjustStockLedger)(item.id, soon.id, 'wh-1', 3);
    (0, repository_js_1.adjustStockLedger)(item.id, none.id, 'wh-1', 10);
    const transferId = `pk-${tag}`;
    (0, repository_js_1.createTransferRecord)({
        id: transferId, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED',
        lines: [{ itemId: item.id, lotId: late.id, quantity: 5 }], createdAt: new Date().toISOString(),
    });
    return { item, lots: { late, soon, none }, transferId };
}
(0, node_test_1.default)('a KG pick is allocated by the server FEFO, previewed first, and never split by the picker', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const { item, lots, transferId } = looseItem();
        const preview = await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 4 });
        strict_1.default.equal(preview.status, 200);
        strict_1.default.deepEqual(preview.body.allocations.map((row) => [row.lotId, row.quantity]), [[lots.soon.id, 3], [lots.late.id, 1]]);
        strict_1.default.equal(preview.body.remaining, 5);
        strict_1.default.equal((await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 6 })).status, 400, 'more than requested');
        // The picker sends only item + weight; the server expands it into lots.
        const requestId = `slip-${unique()}`;
        const slip = await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { requestId, lines: [{ itemId: item.id, quantity: 4, inputMethod: 'MANUAL' }] });
        strict_1.default.equal(slip.status, 201);
        strict_1.default.deepEqual(slip.body.pickSlip.lines.map((line) => [line.lotId, line.quantity]), [[lots.soon.id, 3], [lots.late.id, 1]]);
        strict_1.default.equal(slip.body.transfer.status, 'PARTIAL');
        // A retry of the same slip returns it instead of picking twice.
        const retry = await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { requestId, lines: [{ itemId: item.id, quantity: 4, inputMethod: 'MANUAL' }] });
        strict_1.default.equal(retry.status, 200);
        strict_1.default.equal(retry.body.duplicate, true);
        strict_1.default.equal(retry.body.pickSlip.id, slip.body.pickSlip.id);
        // Resume-safe: the server knows what is left, and lots already picked are not offered twice.
        const state = await call('GET', `/picker/transfers/${transferId}`, picker);
        strict_1.default.equal(state.body.pickSlips.length, 1);
        const next = await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 1 });
        strict_1.default.equal(next.body.remaining, 1);
        strict_1.default.equal(next.body.allocations[0].lotId, lots.late.id, 'the 3 kg lot is used up; the 1 kg left in the next-soonest lot comes next');
        strict_1.default.equal((await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { lines: [{ itemId: item.id, quantity: 2, inputMethod: 'MANUAL' }] })).status, 400, 'over the remaining request');
        const rest = await call('POST', `/picker/transfers/${transferId}/pick-slips`, picker, { finished: true, lines: [{ itemId: item.id, quantity: 1, inputMethod: 'MANUAL' }] });
        strict_1.default.equal(rest.status, 201);
        strict_1.default.equal(rest.body.transfer.status, 'READY_FOR_ADMIN');
    });
});
(0, node_test_1.default)('blocked, expired and empty lots are never picked, and a shelf that cannot cover the request says so', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const { item, lots, transferId } = looseItem();
        (0, repository_js_1.updateLotStatus)(lots.soon.id, 'BLOCKED');
        const blocked = await call('POST', `/picker/transfers/${transferId}/allocation-preview`, picker, { itemId: item.id, quantity: 3 });
        strict_1.default.deepEqual(blocked.body.allocations.map((row) => row.lotId), [lots.late.id, lots.none.id], 'the blocked lot is skipped');
        const empty = (0, repository_js_1.createItemRecord)({ code: `EM-${unique()}`, name: 'Empty', unit: 'KG', pickMethod: 'ITEM_QTY_FIFO', allocationStrategy: 'FEFO', decimalQuantity: true });
        const emptyLot = (0, repository_js_1.ensureLotRecord)(empty.id, `EL-${unique()}`, null);
        (0, repository_js_1.adjustStockLedger)(empty.id, emptyLot.id, 'wh-1', 1);
        (0, repository_js_1.createTransferRecord)({ id: `pk-${unique()}`, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: empty.id, lotId: emptyLot.id, quantity: 5 }], createdAt: new Date().toISOString() });
        const shortTransfer = `pk-${unique()}`;
        (0, repository_js_1.createTransferRecord)({ id: shortTransfer, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: empty.id, lotId: emptyLot.id, quantity: 5 }], createdAt: new Date().toISOString() });
        const shortage = await call('POST', `/picker/transfers/${shortTransfer}/pick-slips`, picker, { lines: [{ itemId: empty.id, quantity: 3, inputMethod: 'MANUAL' }] });
        strict_1.default.equal(shortage.status, 400);
        strict_1.default.match(shortage.body.message, /Only 1 of .* is available/);
        // ... and it can be reported instead of silently short-picked; the exception reason is the real one.
        const reported = await call('POST', `/picker/transfers/${shortTransfer}/pick-slips`, picker, { exceptions: [{ itemId: empty.id, lotId: emptyLot.id, reason: 'NO_STOCK', quantity: 2 }] });
        strict_1.default.equal(reported.status, 201);
    });
});
(0, node_test_1.default)('a piece pick still needs the right scan and refuses a blocked lot', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const tag = unique();
        const item = (0, repository_js_1.createItemRecord)({ code: `PC-${tag}`, name: 'Pieces', unit: 'PCS' });
        const lot = item.lots[0];
        (0, repository_js_1.adjustStockLedger)(item.id, lot.id, 'wh-1', 10);
        const id = `pk-${tag}`;
        (0, repository_js_1.createTransferRecord)({ id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: item.id, lotId: lot.id, quantity: 4 }], createdAt: new Date().toISOString() });
        const line = (scanCode) => ({ lines: [{ itemId: item.id, lotId: lot.id, quantity: 2, inputMethod: 'SCAN', scanCode }] });
        const wrong = await call('POST', `/picker/transfers/${id}/pick-slips`, picker, line('SOMETHING-ELSE'));
        strict_1.default.equal(wrong.status, 400);
        strict_1.default.match(wrong.body.message, /Wrong Item/);
        (0, repository_js_1.updateLotStatus)(lot.id, 'BLOCKED');
        const blocked = await call('POST', `/picker/transfers/${id}/pick-slips`, picker, line(item.code));
        strict_1.default.equal(blocked.status, 400);
        strict_1.default.match(blocked.body.message, /blocked, expired or has no stock/);
        (0, repository_js_1.updateLotStatus)(lot.id, 'AVAILABLE');
        strict_1.default.equal((await call('POST', `/picker/transfers/${id}/pick-slips`, picker, line(item.code))).status, 201);
        // Two lines for the same lot in one slip cannot together exceed what is asked for.
        const twice = await call('POST', `/picker/transfers/${id}/pick-slips`, picker, { lines: [line(item.code).lines[0], line(item.code).lines[0]] });
        strict_1.default.equal(twice.status, 400);
    });
});
