"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const channel_ingest_js_1 = require("./channel-ingest.js");
(0, node_test_1.default)('checksum is deterministic and changes with any byte of the payload', () => {
    const a = (0, channel_ingest_js_1.payloadChecksum)('{"id":"o1"}');
    strict_1.default.equal(a, (0, channel_ingest_js_1.payloadChecksum)('{"id":"o1"}'));
    strict_1.default.notEqual(a, (0, channel_ingest_js_1.payloadChecksum)('{"id":"o2"}'));
    strict_1.default.match(a, /^[0-9a-f]{64}$/);
});
(0, node_test_1.default)('a connector can only resolve catalog rows its own company owns', () => {
    strict_1.default.equal((0, channel_ingest_js_1.ownedByConnectorCompany)('company-a', 'company-a'), true);
    strict_1.default.equal((0, channel_ingest_js_1.ownedByConnectorCompany)('company-b', 'company-a'), false);
});
(0, node_test_1.default)('untracked (legacy) rows are usable only by the default company, never another tenant', () => {
    strict_1.default.equal((0, channel_ingest_js_1.ownedByConnectorCompany)(undefined, 'default-company'), true);
    strict_1.default.equal((0, channel_ingest_js_1.ownedByConnectorCompany)(undefined, 'company-a'), false);
});
