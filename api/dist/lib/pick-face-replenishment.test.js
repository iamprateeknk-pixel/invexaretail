"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pick_face_replenishment_js_1 = require("./pick-face-replenishment.js");
(0, node_test_1.default)('a pick-face bin at or above its min needs nothing', () => {
    const result = (0, pick_face_replenishment_js_1.planPickFaceReplenishment)({ binId: 'pf-1', code: 'A-01-PF', onHand: 5, min: 5, max: 20 }, [{ binId: 'rv-1', code: 'A-99-RES', onHand: 100 }]);
    strict_1.default.equal(result, null);
});
(0, node_test_1.default)('tops up to max from the richest reserve bin', () => {
    const result = (0, pick_face_replenishment_js_1.planPickFaceReplenishment)({ binId: 'pf-1', code: 'A-01-PF', onHand: 2, min: 5, max: 20 }, [
        { binId: 'rv-1', code: 'A-99-RES', onHand: 10 },
        { binId: 'rv-2', code: 'A-98-RES', onHand: 50 },
    ]);
    strict_1.default.deepEqual(result, {
        fromBinId: 'rv-2', fromBinCode: 'A-98-RES',
        toBinId: 'pf-1', toBinCode: 'A-01-PF',
        quantity: 18,
    });
});
(0, node_test_1.default)('caps the suggested quantity to what the richest reserve bin actually has', () => {
    const result = (0, pick_face_replenishment_js_1.planPickFaceReplenishment)({ binId: 'pf-1', code: 'A-01-PF', onHand: 0, min: 5, max: 20 }, [{ binId: 'rv-1', code: 'A-99-RES', onHand: 7 }]);
    strict_1.default.deepEqual(result, {
        fromBinId: 'rv-1', fromBinCode: 'A-99-RES',
        toBinId: 'pf-1', toBinCode: 'A-01-PF',
        quantity: 7,
    });
});
(0, node_test_1.default)('suggests nothing when no reserve bin has stock', () => {
    const result = (0, pick_face_replenishment_js_1.planPickFaceReplenishment)({ binId: 'pf-1', code: 'A-01-PF', onHand: 1, min: 5, max: 20 }, [{ binId: 'rv-1', code: 'A-99-RES', onHand: 0 }]);
    strict_1.default.equal(result, null);
});
