"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const event_bus_js_1 = require("./event-bus.js");
(0, node_test_1.default)('outboxHealthSnapshot returns undefined in memory mode instead of throwing', async () => {
    // The default test run has no DATABASE_URL, so databaseEnabled is false -
    // this must short-circuit cleanly rather than touch prisma at all.
    const snapshot = await (0, event_bus_js_1.outboxHealthSnapshot)();
    strict_1.default.equal(snapshot, undefined);
});
