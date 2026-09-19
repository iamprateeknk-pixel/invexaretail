"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const record_then_persist_js_1 = require("./record-then-persist.js");
(0, node_test_1.default)('a failed database write removes the in-memory record and surfaces the error', async () => {
    const memory = [];
    await strict_1.default.rejects((0, record_then_persist_js_1.recordThenPersist)(() => { memory.push('c1'); return 'c1'; }, async () => { throw new Error('db down'); }, (id) => { memory.splice(memory.indexOf(id), 1); }), /db down/);
    strict_1.default.deepEqual(memory, [], 'no phantom record is left to answer a retry as a duplicate');
});
(0, node_test_1.default)('a successful write keeps the record and returns it', async () => {
    const memory = [];
    const saved = [];
    const result = await (0, record_then_persist_js_1.recordThenPersist)(() => { memory.push('c2'); return 'c2'; }, async (id) => { saved.push(id); }, () => memory.pop());
    strict_1.default.equal(result, 'c2');
    strict_1.default.deepEqual([memory, saved], [['c2'], ['c2']]);
});
