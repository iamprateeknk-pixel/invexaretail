"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const count_reason_codes_js_1 = require("./count-reason-codes.js");
(0, node_test_1.default)('reason codes are optional but must be a known code when given', () => {
    strict_1.default.equal((0, count_reason_codes_js_1.parseCountReasonCode)(undefined), undefined);
    strict_1.default.equal((0, count_reason_codes_js_1.parseCountReasonCode)(' damage '), 'DAMAGE');
    strict_1.default.throws(() => (0, count_reason_codes_js_1.parseCountReasonCode)('lost'), /reasonCode must be one of/);
});
(0, node_test_1.default)('variances are grouped by root cause, uncoded ones are visible, exact matches ignored', () => {
    const rows = (0, count_reason_codes_js_1.summarizeVarianceReasons)([
        { physicalQty: 8, bookQty: 10, reasonCode: 'DAMAGE' },
        { physicalQty: 5, bookQty: 10, reasonCode: 'DAMAGE' },
        { physicalQty: 12, bookQty: 10 },
        { physicalQty: 10, bookQty: 10, reasonCode: 'MISCOUNT' },
    ]);
    strict_1.default.deepEqual(rows, [
        { reasonCode: 'DAMAGE', counts: 2, absoluteUnits: 7, netUnits: -7 },
        { reasonCode: 'UNCODED', counts: 1, absoluteUnits: 2, netUnits: 2 },
    ]);
});
(0, node_test_1.default)('accuracy is tolerance-based and value-weighted, and uncosted counts are left out of the money figures', async () => {
    const { summarizeCountAccuracy } = await import('./count-reason-codes.js');
    const tol = { minUnits: 3, percent: 10 };
    const r = summarizeCountAccuracy([
        { physicalQty: 100, bookQty: 100, unitCost: 10 }, // exact
        { physicalQty: 96, bookQty: 100, unitCost: 10 }, // 4 off, inside 10% of 100
        { physicalQty: 5, bookQty: 20, unitCost: 100 }, // 15 off, outside
        { physicalQty: 1, bookQty: 2 }, // 1 off (inside min 3), uncosted
    ], tol);
    strict_1.default.equal(r.withinTolerance, 3);
    strict_1.default.equal(r.accuracyPercent, 75);
    strict_1.default.equal(r.varianceValue, 1540); // 4x10 + 15x100
    strict_1.default.equal(r.costedCounts, 3);
    strict_1.default.equal(r.valueAccuracyPercent, 61.5); // book = 1000 + 1000 + 2000 = 4000 -> 100 - 1540/4000
});
(0, node_test_1.default)('accuracy is also reported per ABC class so a weak class A cannot hide inside a good blended figure', async () => {
    const { summarizeCountAccuracyByClass } = await import('./count-reason-codes.js');
    const r = summarizeCountAccuracyByClass([
        { physicalQty: 50, bookQty: 100, abcClass: 'A' }, { physicalQty: 100, bookQty: 100, abcClass: 'A' },
        { physicalQty: 10, bookQty: 10, abcClass: 'C' }, { physicalQty: 10, bookQty: 10, abcClass: 'C' }, { physicalQty: 10, bookQty: 10, abcClass: 'C' }, { physicalQty: 9, bookQty: 10, abcClass: 'C' },
    ], { minUnits: 3, percent: 10 });
    strict_1.default.equal(r.accuracyPercent, 83.33);
    strict_1.default.equal(r.byClass.A.accuracyPercent, 50);
    strict_1.default.equal(r.byClass.C.accuracyPercent, 100);
    strict_1.default.equal(r.byClass.B, undefined);
});
