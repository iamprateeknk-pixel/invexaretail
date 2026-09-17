"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const persistence_js_1 = require("./persistence.js");
(0, node_test_1.default)('hydrate and persist are no-ops without MySQL or during node:test', async () => {
    strict_1.default.equal(await (0, persistence_js_1.hydrateControlPlaneFromStore)(), 'skipped');
    (0, persistence_js_1.scheduleControlPlanePersist)();
    await (0, persistence_js_1.flushControlPlanePersist)();
});
