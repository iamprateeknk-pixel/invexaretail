"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const putaway_js_1 = require("./putaway.js");
(0, node_test_1.default)('rankBinCandidates excludes a bin that would overflow its declared capacity', () => {
    const bins = [
        { id: 'full', capacity: 100, zone: 'A', pendingQty: 90 },
        { id: 'room', capacity: 100, zone: 'B', pendingQty: 10 },
    ];
    const winner = (0, putaway_js_1.rankBinCandidates)(bins, { incomingQty: 20, highVelocity: false });
    strict_1.default.equal(winner, 'room');
});
(0, node_test_1.default)('rankBinCandidates falls back to all candidates when every bin would overflow', () => {
    const bins = [
        { id: 'fuller', capacity: 100, zone: 'A', pendingQty: 95 },
        { id: 'less-full', capacity: 100, zone: 'B', pendingQty: 90 },
    ];
    const winner = (0, putaway_js_1.rankBinCandidates)(bins, { incomingQty: 20, highVelocity: false });
    strict_1.default.equal(winner, 'less-full');
});
(0, node_test_1.default)('rankBinCandidates prefers the least-utilized bin by capacity ratio, not raw pending quantity', () => {
    const bins = [
        { id: 'small-but-loaded', capacity: 10, zone: 'A', pendingQty: 8 },
        { id: 'large-with-room', capacity: 1000, zone: 'B', pendingQty: 50 },
    ];
    const winner = (0, putaway_js_1.rankBinCandidates)(bins, { incomingQty: 1, highVelocity: false });
    strict_1.default.equal(winner, 'large-with-room');
});
(0, node_test_1.default)('rankBinCandidates treats an empty unknown-capacity bin as available', () => {
    const bins = [
        { id: 'unknown-empty', capacity: null, zone: 'A', pendingQty: 0 },
        { id: 'known-half-full', capacity: 100, zone: 'B', pendingQty: 50 },
    ];
    const winner = (0, putaway_js_1.rankBinCandidates)(bins, { incomingQty: 1, highVelocity: false });
    strict_1.default.equal(winner, 'unknown-empty');
});
(0, node_test_1.default)('rankBinCandidates prioritizes zone over fullness for a high-velocity item', () => {
    const bins = [
        { id: 'near-zone-busier', capacity: 100, zone: 'A', pendingQty: 40 },
        { id: 'far-zone-emptier', capacity: 100, zone: 'Z', pendingQty: 0 },
    ];
    const winner = (0, putaway_js_1.rankBinCandidates)(bins, { incomingQty: 1, highVelocity: true });
    strict_1.default.equal(winner, 'near-zone-busier');
});
(0, node_test_1.default)('rankBinCandidates ignores zone for a normal-velocity item, ranking by fullness instead', () => {
    const bins = [
        { id: 'near-zone-busier', capacity: 100, zone: 'A', pendingQty: 40 },
        { id: 'far-zone-emptier', capacity: 100, zone: 'Z', pendingQty: 0 },
    ];
    const winner = (0, putaway_js_1.rankBinCandidates)(bins, { incomingQty: 1, highVelocity: false });
    strict_1.default.equal(winner, 'far-zone-emptier');
});
(0, node_test_1.default)('rankBinCandidates returns null for an empty candidate list', () => {
    strict_1.default.equal((0, putaway_js_1.rankBinCandidates)([], { incomingQty: 1, highVelocity: false }), null);
});
