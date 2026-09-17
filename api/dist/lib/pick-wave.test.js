"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pick_wave_js_1 = require("./pick-wave.js");
(0, node_test_1.default)('sequenceKeyForBin builds a walking-order key from the bin hierarchy', () => {
    strict_1.default.equal((0, pick_wave_js_1.sequenceKeyForBin)({ code: 'B12', zone: 'A', aisle: '01', rack: '03', shelf: '2' }), 'A-01-03-2-B12');
    strict_1.default.equal((0, pick_wave_js_1.sequenceKeyForBin)({ code: 'B12', zone: null, aisle: null, rack: null, shelf: null }), 'B12');
});
(0, node_test_1.default)('sequenceKeyForBin sorts bin-less items after every known bin', () => {
    const keys = [(0, pick_wave_js_1.sequenceKeyForBin)({ code: 'A01', zone: 'A' }), (0, pick_wave_js_1.sequenceKeyForBin)(null), (0, pick_wave_js_1.sequenceKeyForBin)({ code: 'B01', zone: 'B' })].sort();
    strict_1.default.equal(keys[keys.length - 1], '~unassigned');
});
