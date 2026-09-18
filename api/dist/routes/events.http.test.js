"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const event_bus_js_1 = require("../lib/event-bus.js");
const event_topics_js_1 = require("../lib/event-topics.js");
const enterprise_auth_js_1 = require("./enterprise-auth.js");
const core_js_1 = __importDefault(require("./core.js"));
const events_js_1 = __importStar(require("./events.js"));
const tenant_scope_js_1 = require("../lib/saas/tenant-scope.js");
function userFor(email) {
    const user = (0, enterprise_repository_js_1.findUserByEmail)(email);
    if (!user)
        throw new Error(`missing workspace user ${email}`);
    return user;
}
async function withServer(run) {
    (0, enterprise_repository_js_1.seedEnhancedUsersForMemoryMode)(seed_js_1.seedUsers, (0, otp_auth_js_1.hashPassword)(process.env.SEED_PASSWORD ?? 'ChangeMe123!'));
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/v1', enterprise_auth_js_1.extractToken, tenant_scope_js_1.enforceOperationalCompanyScope);
    app.use('/api/v1', events_js_1.default);
    app.use('/api/v1', events_js_1.publishMutationEvents);
    app.use('/api/v1', core_js_1.default);
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('failed to bind test server');
    }
    try {
        await run(`http://127.0.0.1:${address.port}`);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
// Reads the SSE stream until `done` says the accumulated text is enough.
async function readStream(url, token, done, headers = {}, path = '/api/v1/events') {
    const controller = new AbortController();
    const response = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers }, signal: controller.signal });
    strict_1.default.equal(response.status, 200);
    strict_1.default.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        while (!done(text)) {
            const { value, done: finished } = await reader.read();
            if (finished)
                break;
            text += decoder.decode(value, { stream: true });
        }
    }
    finally {
        clearTimeout(timeout);
        controller.abort();
    }
    return text;
}
(0, node_test_1.default)('topicsForMutation maps successful writes to blueprint topics and ignores reads/previews', () => {
    strict_1.default.deepEqual((0, event_topics_js_1.topicsForMutation)('GET', '/items'), []);
    strict_1.default.deepEqual((0, event_topics_js_1.topicsForMutation)('POST', '/imports/sales/preview'), []);
    strict_1.default.deepEqual((0, event_topics_js_1.topicsForMutation)('POST', '/items'), ['item.changed']);
    strict_1.default.deepEqual((0, event_topics_js_1.topicsForMutation)('POST', '/stock-counts'), ['count.changed']);
    strict_1.default.deepEqual(new Set((0, event_topics_js_1.topicsForMutation)('POST', '/stock-counts/c1/review')), new Set(['count.changed', 'stock.changed']));
    strict_1.default.deepEqual(new Set((0, event_topics_js_1.topicsForMutation)('POST', '/transfers/t1/receive')), new Set(['transfer.changed', 'stock.changed', 'receipt.changed']));
    strict_1.default.deepEqual(new Set((0, event_topics_js_1.topicsForMutation)('POST', '/imports/sales/commit')), new Set(['import.committed', 'stock.changed']));
    strict_1.default.deepEqual((0, event_topics_js_1.topicsForMutation)('PUT', '/users/u1/permissions'), ['permission.changed']);
    strict_1.default.deepEqual((0, event_topics_js_1.topicsForMutation)('POST', '/unknown-thing'), []);
});
(0, node_test_1.default)('locationIdsForMutation reads locations from the path and body', () => {
    strict_1.default.equal((0, event_topics_js_1.locationIdsForMutation)('/items', {}), undefined);
    strict_1.default.deepEqual((0, event_topics_js_1.locationIdsForMutation)('/locations/loc-1/bin-transfers', {}), ['loc-1']);
    strict_1.default.deepEqual(new Set((0, event_topics_js_1.locationIdsForMutation)('/transfers', { sourceLocationId: 'a', destinationLocationId: 'b' })), new Set(['a', 'b']));
});
(0, node_test_1.default)('canReceive scopes events by company and location', () => {
    const event = { id: 1, topic: 'stock.changed', companyId: 'c1', locationIds: ['loc-1'], at: '' };
    strict_1.default.equal((0, event_bus_js_1.canReceive)({ companyId: 'c1', locationIds: null }, event), true);
    strict_1.default.equal((0, event_bus_js_1.canReceive)({ companyId: 'c1', locationIds: ['loc-1', 'loc-2'] }, event), true);
    strict_1.default.equal((0, event_bus_js_1.canReceive)({ companyId: 'c1', locationIds: ['loc-9'] }, event), false);
    strict_1.default.equal((0, event_bus_js_1.canReceive)({ companyId: 'c2', locationIds: null }, event), false);
    strict_1.default.equal((0, event_bus_js_1.canReceive)({ companyId: 'c1', locationIds: ['loc-9'] }, { ...event, locationIds: undefined }), true);
});
(0, node_test_1.default)('eventsSince replays after a cursor and resets on stale or foreign cursors', () => {
    (0, event_bus_js_1.resetEventBusForTests)();
    const sub = { companyId: 'c1', locationIds: null };
    (0, event_bus_js_1.publishEvent)({ topic: 'stock.changed', companyId: 'c1' });
    (0, event_bus_js_1.publishEvent)({ topic: 'count.changed', companyId: 'c1' });
    (0, event_bus_js_1.publishEvent)({ topic: 'item.changed', companyId: 'other' });
    const replay = (0, event_bus_js_1.eventsSince)(1, sub);
    strict_1.default.equal(replay.kind, 'replay');
    strict_1.default.deepEqual(replay.kind === 'replay' ? replay.events.map((e) => e.topic) : [], ['count.changed']);
    strict_1.default.equal((0, event_bus_js_1.eventsSince)(99, sub).kind, 'reset');
    strict_1.default.equal((0, event_bus_js_1.eventsSince)(0, sub, 'some-old-epoch').kind, 'reset');
    strict_1.default.equal((0, event_bus_js_1.eventsSince)(3, sub, event_bus_js_1.SERVER_EPOCH).kind, 'replay');
});
(0, node_test_1.default)('HTTP: stream requires auth', async () => {
    await withServer(async (url) => {
        const response = await fetch(`${url}/api/v1/events`);
        strict_1.default.equal(response.status, 401);
    });
});
(0, node_test_1.default)('HTTP: a committed mutation is pushed to an open stream, and a reconnect replays what was missed', async () => {
    (0, event_bus_js_1.resetEventBusForTests)();
    await withServer(async (url) => {
        const admin = userFor('admin@retail.local');
        const token = (0, otp_auth_js_1.generateJWT)(admin.id, admin.companyId);
        const listening = readStream(url, token, (text) => text.includes('event: item.changed'));
        // Give the stream a moment to register before mutating.
        await new Promise((resolve) => setTimeout(resolve, 150));
        const create = await fetch(`${url}/api/v1/items`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: `LIVE-${Date.now()}`, name: 'Live sync item' }),
        });
        strict_1.default.equal(create.status, 201);
        const live = await listening;
        strict_1.default.match(live, /event: hello/);
        strict_1.default.match(live, /event: item\.changed/);
        // A failed mutation must publish nothing.
        const before = live.match(/event: item\.changed/g)?.length ?? 0;
        const bad = await fetch(`${url}/api/v1/items`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'no code' }),
        });
        strict_1.default.ok(bad.status >= 400);
        // Reconnect from cursor 0: the earlier item.changed comes back as a replay.
        const replayed = await readStream(url, token, (text) => text.includes('event: item.changed'), { 'Last-Event-ID': '0' });
        strict_1.default.match(replayed, /event: item\.changed/);
        strict_1.default.equal(replayed.match(/event: item\.changed/g)?.length, before);
        // A cursor from the future (server restarted) asks the client to resync everything.
        const reset = await readStream(url, token, (text) => text.includes('event: reset'), { 'Last-Event-ID': '99999' });
        strict_1.default.match(reset, /event: reset/);
    });
});
