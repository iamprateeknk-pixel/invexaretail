"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const memory_mode_js_1 = require("./memory-mode.js");
function invokeMemoryGuard(method, path) {
    let statusCode = 200;
    let body;
    let nextCalled = false;
    const req = { method, path, url: path };
    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(payload) {
            body = payload;
            return this;
        },
    };
    const next = (() => { nextCalled = true; });
    (0, memory_mode_js_1.respondWhenMemoryUnavailable)(req, res, next);
    return { statusCode, body, nextCalled };
}
(0, node_test_1.default)('memory mode returns empty collections for dashboard Prisma GETs', () => {
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/asset-checkouts'), { checkouts: [] });
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/jobs'), { jobs: [] });
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/orders'), { orders: [] });
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/catalog/tags'), { tags: [] });
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/catalog/custom-fields'), { fields: [] });
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/notification-inbox'), { notifications: [] });
    strict_1.default.equal((0, memory_mode_js_1.memoryGetPayload)('/expiry-board'), null);
    strict_1.default.equal((0, memory_mode_js_1.memoryGetPayload)('/reorder-rules'), null);
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/catalog/items/item-1'), { tags: [], customFields: [] });
    strict_1.default.deepEqual((0, memory_mode_js_1.memoryGetPayload)('/comments/item/item-1'), { comments: [] });
});
(0, node_test_1.default)('expiry and replenishment paths are implemented in memory mode', () => {
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/expiry-board', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/expiry-write-off', 'POST'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/lots/lot-1/expiry', 'PATCH'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/lots/lot-1/status', 'PATCH'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/reorder-rules', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/reorder-rules/item-1001', 'PUT'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/intelligence/loc-1', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/webhook-subscriptions', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/webhook-subscriptions', 'POST'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/webhook-subscriptions/hook-1/status', 'PATCH'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/webhook-deliveries', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/saas/plans', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/connectors', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/mobile/home', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/qc-templates', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/qc-inspections', 'POST'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/orders', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/orders', 'POST'), true);
    strict_1.default.equal(invokeMemoryGuard('GET', '/orders').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('POST', '/orders').nextCalled, true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/locations/loc-1/bin-stock', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/locations/loc-1/bins', 'GET'), true);
    strict_1.default.equal((0, memory_mode_js_1.isMemoryImplementedPath)('/locations/loc-1/bins', 'POST'), true);
    strict_1.default.equal(invokeMemoryGuard('GET', '/locations/loc-1/bins').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('GET', '/expiry-board').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('POST', '/expiry-write-off').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('GET', '/reorder-rules').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('PUT', '/reorder-rules/item-1001').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('GET', '/intelligence/loc-1').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('POST', '/webhook-subscriptions').nextCalled, true);
    strict_1.default.equal(invokeMemoryGuard('GET', '/webhook-deliveries').nextCalled, true);
});
(0, node_test_1.default)('unknown Prisma paths stay unavailable in memory mode', () => {
    strict_1.default.equal((0, memory_mode_js_1.memoryGetPayload)('/jobs/job-1'), null);
    strict_1.default.equal(memory_mode_js_1.MEMORY_MODE_UNAVAILABLE.code, 'MEMORY_MODE');
});
(0, node_test_1.default)('memory-mode middleware returns empty dashboard lists instead of querying Prisma', () => {
    strict_1.default.equal(Boolean(process.env.DATABASE_URL), false);
    const jobs = invokeMemoryGuard('GET', '/jobs');
    strict_1.default.equal(jobs.nextCalled, false);
    strict_1.default.deepEqual(jobs.body, { jobs: [] });
    const checkouts = invokeMemoryGuard('GET', '/asset-checkouts');
    strict_1.default.deepEqual(checkouts.body, { checkouts: [] });
});
(0, node_test_1.default)('memory-mode middleware rejects writes with 501', () => {
    const created = invokeMemoryGuard('POST', '/jobs');
    strict_1.default.equal(created.statusCode, 501);
    strict_1.default.deepEqual(created.body, {
        message: memory_mode_js_1.MEMORY_MODE_UNAVAILABLE.message,
        code: memory_mode_js_1.MEMORY_MODE_UNAVAILABLE.code,
    });
});
(0, node_test_1.default)('runtime persistence keys off DATABASE_URL, not PERSISTENCE_MODE', () => {
    const persistence = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src/lib/persistence.ts'), 'utf8');
    const index = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'src/index.ts'), 'utf8');
    strict_1.default.equal(persistence.includes('PERSISTENCE_MODE'), false);
    strict_1.default.equal(index.includes('PERSISTENCE_MODE'), false);
});
