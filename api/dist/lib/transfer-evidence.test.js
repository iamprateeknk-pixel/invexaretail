"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const transfer_evidence_js_1 = require("./transfer-evidence.js");
(0, node_test_1.default)('accepts supported photo signatures', () => {
    strict_1.default.equal((0, transfer_evidence_js_1.evidenceMime)(Buffer.from([255, 216, 255, 224])), 'image/jpeg');
    strict_1.default.equal((0, transfer_evidence_js_1.evidenceMime)(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
    strict_1.default.equal((0, transfer_evidence_js_1.evidenceMime)(Buffer.from('RIFF1234WEBP')), 'image/webp');
});
(0, node_test_1.default)('rejects executable content, empty files and oversized photos', () => {
    strict_1.default.throws(() => (0, transfer_evidence_js_1.evidenceMime)(Buffer.from('<svg onload="alert(1)"/>')));
    strict_1.default.throws(() => (0, transfer_evidence_js_1.evidenceMime)(Buffer.alloc(0)));
    strict_1.default.throws(() => (0, transfer_evidence_js_1.evidenceMime)(Buffer.alloc(5 * 1024 * 1024 + 1)));
});
