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
const transfer_logistics_js_1 = __importDefault(require("./transfer-logistics.js"));
const core_js_1 = __importDefault(require("./core.js"));
const transfers_js_1 = __importDefault(require("./transfers.js"));
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
    app.use('/api/v1', transfer_logistics_js_1.default);
    app.use('/api/v1', transfers_js_1.default);
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
const unique = () => Math.random().toString(36).slice(2, 8);
// wh-1 -> loc-1, 10 x item-1003 and 5 x item-1001, already confirmed (stock left the source).
function confirmedTransfer(id = `tr-${unique()}`) {
    (0, repository_js_1.createTransferRecord)({
        id, sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', requestedBy: 'user-admin-1', role: 'ADMIN', status: 'CONFIRMED',
        lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 10 }, { itemId: 'item-1001', lotId: 'lot-1001', quantity: 5 }],
        createdAt: new Date().toISOString(),
    });
    return id;
}
const carton = (lines, extra = {}) => ({
    lines: lines.map(([itemId, lotId, quantity]) => ({ itemId, lotId, quantity })), ...extra,
});
(0, node_test_1.default)('packing re-verifies cartons, refuses a mismatch, and only completes when every line is packed', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const id = confirmedTransfer();
        const state = await call('GET', `/transfers/${id}/pack`, picker);
        strict_1.default.equal(state.status, 200);
        strict_1.default.deepEqual(state.body.expected.map((row) => row.requestedQty).sort((a, b) => a - b), [5, 10]);
        strict_1.default.equal(state.body.canComplete, false);
        // A carton with more than was picked, or an item that is not on the transfer, is not sealed.
        const over = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 11]]));
        strict_1.default.equal(over.status, 409);
        strict_1.default.equal(over.body.mismatches[0].kind, 'OVER');
        const stranger = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1002', 'lot-1002', 1]]));
        strict_1.default.equal(stranger.status, 409);
        strict_1.default.equal(stranger.body.mismatches[0].kind, 'UNEXPECTED');
        strict_1.default.equal((await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 0]]))).status, 400);
        // Completing early is refused.
        const early = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 6]], { weightKg: 4.2, requestId: 'c1' }));
        strict_1.default.equal(early.status, 201);
        strict_1.default.match(early.body.carton.packageId, /^PKG-.{6}-01$/);
        strict_1.default.equal((await call('POST', `/transfers/${id}/pack/complete`, picker)).status, 409);
        // The same request again does not seal a second carton.
        const retry = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 6]], { requestId: 'c1' }));
        strict_1.default.equal(retry.body.duplicate, true);
        strict_1.default.equal(retry.body.cartons.filter((row) => row.status === 'SEALED').length, 1);
        // A second carton finishes the job; a voided carton no longer counts.
        const second = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 4], ['item-1001', 'lot-1001', 5]]));
        strict_1.default.equal(second.status, 201);
        strict_1.default.equal(second.body.verification.readyToSeal, true);
        const voided = await call('POST', `/transfers/${id}/cartons/${second.body.carton.id}/void`, picker);
        strict_1.default.equal(voided.body.verification.readyToSeal, false);
        const third = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 4], ['item-1001', 'lot-1001', 5]]));
        strict_1.default.equal(third.body.carton.packageId.endsWith('-03'), true);
        const done = await call('POST', `/transfers/${id}/pack/complete`, picker);
        strict_1.default.equal(done.status, 200);
        strict_1.default.equal(done.body.packing.cartonCount, 2);
        strict_1.default.equal((0, repository_js_1.listTransfers)().find((row) => row.id === id)?.cartonCount, 2);
        // Sealed packing is final.
        strict_1.default.equal((await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 1]]))).status, 409);
    });
});
(0, node_test_1.default)('dispatch needs finished packing and a carrier, records the details, and flags a late arrival', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const admin = tokenFor('admin@retail.local');
        const id = confirmedTransfer();
        // Not packed yet.
        strict_1.default.equal((await call('POST', `/transfers/${id}/dispatch`, admin, { vehicleNo: 'MH12AB1234' })).status, 409);
        for (const lines of [[['item-1003', 'lot-1003', 10]], [['item-1001', 'lot-1001', 5]]]) {
            strict_1.default.equal((await call('POST', `/transfers/${id}/cartons`, picker, carton(lines))).status, 201);
        }
        // The legacy status route also refuses to skip a started-but-unfinished packing.
        strict_1.default.equal((await call('PATCH', `/transfers/${id}/status`, admin, { status: 'DISPATCHED' })).status, 409);
        strict_1.default.equal((await call('POST', `/transfers/${id}/pack/complete`, picker)).status, 200);
        // A picker cannot dispatch; a carrier/vehicle/AWB is required.
        strict_1.default.equal((await call('POST', `/transfers/${id}/dispatch`, picker, { vehicleNo: 'X' })).status, 403);
        const bare = await call('POST', `/transfers/${id}/dispatch`, admin, {});
        strict_1.default.equal(bare.status, 400);
        strict_1.default.match(bare.body.message, /vehicle number, courier or AWB/);
        const soon = new Date(Date.now() + 3_600_000).toISOString();
        const sent = await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'BlueDart', awb: 'AWB-77', expectedArrivalAt: soon });
        strict_1.default.equal(sent.status, 200);
        strict_1.default.equal(sent.body.transfer.status, 'DISPATCHED');
        strict_1.default.equal(sent.body.transfer.dispatch.awb, 'AWB-77');
        const again = await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'BlueDart', awb: 'AWB-77' });
        strict_1.default.equal(again.body.duplicate, true);
        const tracking = await call('GET', `/transfers/${id}/tracking`, admin);
        strict_1.default.equal(tracking.body.delayed, false);
        strict_1.default.equal(tracking.body.cartons.length, 2);
        // Past its promised arrival and not received: delayed.
        const late = confirmedTransfer();
        for (const lines of [[['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]]) {
            await call('POST', `/transfers/${late}/cartons`, picker, carton(lines));
        }
        await call('POST', `/transfers/${late}/pack/complete`, picker);
        await call('POST', `/transfers/${late}/dispatch`, admin, { vehicleNo: 'KA01', expectedArrivalAt: new Date(Date.now() - 3_600_000).toISOString() });
        strict_1.default.equal((await call('GET', `/transfers/${late}/tracking`, admin)).body.delayed, true);
        const listed = (await call('GET', '/transfers/list', admin)).body.transfers.find((row) => row.id === late);
        strict_1.default.equal(listed.delayed, true);
        strict_1.default.equal(listed.cartons.length, 1);
    });
});
(0, node_test_1.default)('a carton code leads the destination to its transfer', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const store = tokenFor('store@retail.local');
        const id = confirmedTransfer();
        const sealed = await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
        const found = await call('GET', `/transfers/by-package/${sealed.body.carton.packageId.toLowerCase()}`, store);
        strict_1.default.equal(found.status, 200);
        strict_1.default.equal(found.body.transfer.id, id);
        strict_1.default.equal((await call('GET', '/transfers/by-package/PKG-NOPE-01', store)).status, 404);
    });
});
(0, node_test_1.default)('a receive retried after a timeout returns the first result and posts destination stock once', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const admin = tokenFor('admin@retail.local');
        const store = tokenFor('store@retail.local');
        const id = confirmedTransfer();
        await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
        await call('POST', `/transfers/${id}/pack/complete`, picker);
        strict_1.default.equal((await call('POST', `/transfers/${id}/dispatch`, admin, { vehicleNo: 'GJ05' })).status, 200);
        const before = (0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.onHand ?? 0;
        const requestId = `rcv-${unique()}`;
        const body = {
            requestId,
            lines: [
                { itemId: 'item-1003', lotId: 'lot-1003', receivedQty: 10 },
                { itemId: 'item-1001', lotId: 'lot-1001', receivedQty: 5 },
            ],
        };
        const first = await call('POST', `/transfers/${id}/receive`, store, body);
        strict_1.default.equal(first.status, 200);
        strict_1.default.equal(first.body.duplicate, false);
        strict_1.default.equal(first.body.receipt.status, 'RECEIVED');
        strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.onHand, before + 10);
        // The transfer is now fully received, yet the retry still gets the recorded result.
        const retry = await call('POST', `/transfers/${id}/receive`, store, body);
        strict_1.default.equal(retry.status, 200);
        strict_1.default.equal(retry.body.duplicate, true);
        strict_1.default.equal(retry.body.receipt.receivedQty, 15);
        strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.onHand, before + 10, 'no second posting');
        // A different request against the finished transfer is an ordinary error, and the key cannot be reused elsewhere.
        strict_1.default.equal((await call('POST', `/transfers/${id}/receive`, store, { ...body, requestId: `rcv-${unique()}` })).status, 400);
        const other = confirmedTransfer();
        strict_1.default.equal((await call('POST', `/transfers/${other}/receive`, store, body)).status, 409);
    });
});
(0, node_test_1.default)('a partial receipt keeps the transfer open and a retry of it still posts once', async () => {
    await withServer(async (call) => {
        const picker = tokenFor('picker@retail.local');
        const admin = tokenFor('admin@retail.local');
        const store = tokenFor('store@retail.local');
        const id = confirmedTransfer();
        await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
        await call('POST', `/transfers/${id}/pack/complete`, picker);
        await call('POST', `/transfers/${id}/dispatch`, admin, { carrier: 'Local van' });
        const before = (0, repository_js_1.findStockLedgerEntry)('item-1001', 'lot-1001', 'loc-1')?.onHand ?? 0;
        const requestId = `rcv-${unique()}`;
        const partial = { requestId, lines: [{ itemId: 'item-1001', lotId: 'lot-1001', receivedQty: 3, shortageQty: 2 }] };
        const first = await call('POST', `/transfers/${id}/receive`, store, partial);
        strict_1.default.equal(first.status, 200);
        strict_1.default.equal(first.body.receipt.status, 'PARTIAL_RECEIVED');
        const retry = await call('POST', `/transfers/${id}/receive`, store, partial);
        strict_1.default.equal(retry.body.duplicate, true);
        strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1001', 'lot-1001', 'loc-1')?.onHand, before + 3);
        strict_1.default.equal((0, repository_js_1.listTransfers)().find((row) => row.id === id)?.status, 'PARTIAL_RECEIVED');
    });
});
(0, node_test_1.default)('QC gates a transfer receipt: no inspection blocks it, a failed one quarantines instead of stocking', async () => {
    const { createMemoryQcTemplate, recordMemoryQcInspection, resetMemoryQc } = await import('../lib/qc-inspection.js');
    resetMemoryQc();
    createMemoryQcTemplate({ label: 'Global', category: null, checks: [{ key: 'seal', label: 'Seal intact' }], createdById: 'user-admin-1' });
    try {
        await withServer(async (call) => {
            const picker = tokenFor('picker@retail.local');
            const admin = tokenFor('admin@retail.local');
            const store = tokenFor('store@retail.local');
            const id = confirmedTransfer();
            await call('POST', `/transfers/${id}/cartons`, picker, carton([['item-1003', 'lot-1003', 10], ['item-1001', 'lot-1001', 5]]));
            await call('POST', `/transfers/${id}/pack/complete`, picker);
            await call('POST', `/transfers/${id}/dispatch`, admin, { vehicleNo: 'QC1' });
            const lines = [{ itemId: 'item-1003', lotId: 'lot-1003', receivedQty: 10 }, { itemId: 'item-1001', lotId: 'lot-1001', receivedQty: 5 }];
            const blocked = await call('POST', `/transfers/${id}/receive`, store, { requestId: `q-${unique()}`, lines });
            strict_1.default.equal(blocked.status, 400);
            strict_1.default.equal(blocked.body.code, 'QC_REQUIRED');
            const inspector = { inspectedById: 'user-admin-1', sourceDocument: id, locationId: 'loc-1' };
            recordMemoryQcInspection({ ...inspector, itemId: 'item-1003', results: { seal: 'FAIL' } });
            recordMemoryQcInspection({ ...inspector, itemId: 'item-1001', results: { seal: 'PASS' } });
            const soap = (0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1');
            const rice = (0, repository_js_1.findStockLedgerEntry)('item-1001', 'lot-1001', 'loc-1');
            const [soapOn, soapQ, riceOn] = [soap?.onHand ?? 0, soap?.quarantine ?? 0, rice?.onHand ?? 0];
            const done = await call('POST', `/transfers/${id}/receive`, store, { requestId: `q-${unique()}`, lines });
            strict_1.default.equal(done.status, 200);
            strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.onHand, soapOn, 'the failed lot did not become sellable');
            strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1003', 'lot-1003', 'loc-1')?.quarantine, soapQ + 10, 'it is held in quarantine');
            strict_1.default.equal((0, repository_js_1.findStockLedgerEntry)('item-1001', 'lot-1001', 'loc-1')?.onHand, riceOn + 5, 'the passed lot is stocked as usual');
        });
    }
    finally {
        resetMemoryQc();
    }
});
(0, node_test_1.default)('editable transfer requests can be changed and deleted, but started transfers are protected', async () => {
    await withServer(async (call) => {
        const admin = tokenFor('admin@retail.local');
        const created = await call('POST', '/transfers', admin, {
            sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', cartonCount: 1,
            lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 1 }],
        });
        strict_1.default.equal(created.status, 201);
        const id = created.body.transfer.id;
        const edited = await call('PATCH', `/transfers/${id}`, admin, {
            sourceLocationId: 'wh-1', destinationLocationId: 'loc-1', cartonCount: 2,
            lines: [{ itemId: 'item-1003', lotId: 'lot-1003', quantity: 2 }],
        });
        strict_1.default.equal(edited.status, 200);
        strict_1.default.deepEqual([edited.body.transfer.cartonCount, edited.body.transfer.lines[0].quantity], [2, 2]);
        const listed = (await call('GET', '/transfers/list', admin)).body.transfers.find((row) => row.id === id);
        strict_1.default.deepEqual([listed.cartonCount, listed.lines[0].quantity], [2, 2]);
        strict_1.default.equal((await call('DELETE', `/transfers/${id}`, admin)).status, 200);
        strict_1.default.equal((0, repository_js_1.listTransfers)().some((row) => row.id === id), false);
        const started = confirmedTransfer();
        strict_1.default.equal((await call('DELETE', `/transfers/${started}`, admin)).status, 403);
    });
});
