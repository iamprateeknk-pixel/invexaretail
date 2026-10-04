"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const document_number_js_1 = require("./document-number.js");
(0, node_test_1.default)('numbers are prefixed, dated and human-readable', () => {
    strict_1.default.match((0, document_number_js_1.newDocumentNumber)('PO', new Date('2026-09-25T10:00:00Z')), /^PO-260925-[0-9A-HJ-NP-Z]{8}$/);
    strict_1.default.match((0, document_number_js_1.newDocumentNumber)('JOB', new Date('2027-01-02T00:00:00Z')), /^JOB-270102-/);
});
(0, node_test_1.default)('the same instant does not produce the same number (the old clock-suffix scheme did)', () => {
    const at = new Date('2026-09-25T10:00:00.000Z');
    const seen = new Set(Array.from({ length: 5000 }, () => (0, document_number_js_1.newDocumentNumber)('PO', at)));
    strict_1.default.equal(seen.size, 5000);
});
