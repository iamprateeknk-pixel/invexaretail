"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const scan_enforcement_js_1 = require("./scan-enforcement.js");
(0, node_test_1.default)('assertPutawayScan requires a scan and rejects a bin from another location', () => {
    strict_1.default.equal((0, scan_enforcement_js_1.assertPutawayScan)({ scannedBinCode: '', allowedBinCodes: ['A-01'] }).ok, false);
    const wrongLocation = (0, scan_enforcement_js_1.assertPutawayScan)({ scannedBinCode: 'B-99', allowedBinCodes: ['A-01', 'A-02'] });
    strict_1.default.equal(wrongLocation.ok, false);
    if (!wrongLocation.ok)
        strict_1.default.equal(wrongLocation.code, 'WRONG_LOCATION_BIN');
});
(0, node_test_1.default)('assertPutawayScan blocks a valid-but-wrong bin unless override is set', () => {
    const blocked = (0, scan_enforcement_js_1.assertPutawayScan)({
        scannedBinCode: 'A-02',
        suggestedBinCode: 'A-01',
        allowedBinCodes: ['A-01', 'A-02'],
    });
    strict_1.default.equal(blocked.ok, false);
    if (!blocked.ok)
        strict_1.default.equal(blocked.code, 'WRONG_BIN');
    const overridden = (0, scan_enforcement_js_1.assertPutawayScan)({
        scannedBinCode: 'A-02',
        suggestedBinCode: 'A-01',
        allowedBinCodes: ['A-01', 'A-02'],
        allowOverride: true,
    });
    strict_1.default.equal(overridden.ok, true);
});
(0, node_test_1.default)('assertPutawayScan accepts the suggested bin case-insensitively', () => {
    strict_1.default.equal((0, scan_enforcement_js_1.assertPutawayScan)({
        scannedBinCode: 'a-01',
        suggestedBinCode: 'A-01',
        allowedBinCodes: ['A-01'],
    }).ok, true);
});
(0, node_test_1.default)('assertGuidedWalkScan only accepts the next bin in walking order', () => {
    const walk = ['Z1-A-01', 'Z1-A-02', 'Z2-B-01'];
    strict_1.default.equal((0, scan_enforcement_js_1.assertGuidedWalkScan)({ scannedBinCode: 'Z1-A-02', walkOrder: walk, scannedIndex: 0 }).ok, false);
    strict_1.default.equal((0, scan_enforcement_js_1.assertGuidedWalkScan)({ scannedBinCode: 'Z1-A-01', walkOrder: walk, scannedIndex: 0 }).ok, true);
    strict_1.default.equal((0, scan_enforcement_js_1.assertGuidedWalkScan)({ scannedBinCode: 'Z1-A-02', walkOrder: walk, scannedIndex: 1 }).ok, true);
    strict_1.default.equal((0, scan_enforcement_js_1.nextWalkBin)(walk, 2), 'Z2-B-01');
    strict_1.default.equal((0, scan_enforcement_js_1.nextWalkBin)(walk, 3), null);
});
