"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const offline_command_contract_js_1 = require("./offline-command-contract.js");
const caller = { companyId: 'c1', actorId: 'u1' };
const command = (over = {}) => ({
    contractVersion: offline_command_contract_js_1.OFFLINE_CONTRACT_VERSION,
    commandId: '3f8f1c1e-6a53-4d6c-9d1e-0a1b2c3d4e5f',
    type: 'COUNT_SUBMIT', companyId: 'c1', actorId: 'u1',
    entityType: 'count', entityId: 'k1', baseVersion: 2,
    occurredAt: '2026-09-25T10:00:00Z', payload: { qty: 4 }, ...over,
});
const store = (version, applied = new Map()) => ({
    find: (company, id) => applied.get(`${company}:${id}`),
    currentVersion: () => version,
});
const code = (out) => out.code;
(0, node_test_1.default)('a fresh command at the current version is ready to apply', () => {
    strict_1.default.equal((0, offline_command_contract_js_1.evaluateOfflineCommand)(command(), caller, store(2)).status, 'READY');
});
(0, node_test_1.default)('a retried command returns the original result and is never re-applied', () => {
    const applied = new Map([[`c1:${command().commandId}`, { entityVersion: 3 }]]);
    strict_1.default.deepEqual((0, offline_command_contract_js_1.evaluateOfflineCommand)(command(), caller, store(3, applied)), { status: 'DUPLICATE', entityVersion: 3, result: undefined });
});
(0, node_test_1.default)('a stale base version is a visible conflict, not an overwrite', () => {
    strict_1.default.deepEqual((0, offline_command_contract_js_1.evaluateOfflineCommand)(command({ baseVersion: 1 }), caller, store(2)), { status: 'CONFLICT', serverVersion: 2, baseVersion: 1 });
});
(0, node_test_1.default)('tenant/actor come from the session; other contract versions and malformed input are rejected', () => {
    strict_1.default.equal(code((0, offline_command_contract_js_1.evaluateOfflineCommand)(command({ companyId: 'c2' }), caller, store(2))), 'TENANT_MISMATCH');
    strict_1.default.equal(code((0, offline_command_contract_js_1.evaluateOfflineCommand)(command({ actorId: 'u2' }), caller, store(2))), 'TENANT_MISMATCH');
    strict_1.default.equal(code((0, offline_command_contract_js_1.evaluateOfflineCommand)(command({ contractVersion: 99 }), caller, store(2))), 'CONTRACT_VERSION');
    for (const bad of [null, command({ commandId: 'nope' }), command({ type: 'X' }), command({ baseVersion: -1 }), command({ payload: [] }), command({ occurredAt: 'x' })]) {
        strict_1.default.equal(code((0, offline_command_contract_js_1.evaluateOfflineCommand)(bad, caller, store(2))), 'INVALID_COMMAND');
    }
});
