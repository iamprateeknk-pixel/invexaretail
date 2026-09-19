"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const order_scheduler_js_1 = require("./order-scheduler.js");
(0, node_test_1.default)('a sweep expires first, then retries backorders, and announces only when something changed', async () => {
    const calls = [];
    const deps = (expired, filled) => ({
        expire: async () => { calls.push('expire'); return expired; },
        retry: async () => { calls.push('retry'); return filled; },
        announce: () => { calls.push('announce'); },
    });
    strict_1.default.deepEqual(await (0, order_scheduler_js_1.orderSweepTick)(deps(2, 1)), { expired: 2, filled: 1 });
    strict_1.default.deepEqual(calls, ['expire', 'retry', 'announce']);
    calls.length = 0;
    await (0, order_scheduler_js_1.orderSweepTick)(deps(0, 0));
    strict_1.default.deepEqual(calls, ['expire', 'retry']);
});
(0, node_test_1.default)('a failing sweep is swallowed, and overlapping sweeps are not stacked', async () => {
    const failing = { expire: async () => { throw new Error('db down'); }, retry: async () => 0, announce: () => undefined };
    strict_1.default.equal(await (0, order_scheduler_js_1.orderSweepTick)(failing), null);
    let release = () => undefined;
    const slow = { expire: () => new Promise((resolve) => { release = () => resolve(0); }), retry: async () => 0, announce: () => undefined };
    const first = (0, order_scheduler_js_1.orderSweepTick)(slow);
    strict_1.default.equal(await (0, order_scheduler_js_1.orderSweepTick)(slow), null, 'the second pass is skipped while the first runs');
    release();
    strict_1.default.deepEqual(await first, { expired: 0, filled: 0 });
});
