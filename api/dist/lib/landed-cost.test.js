"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const landed_cost_js_1 = require("./landed-cost.js");
(0, node_test_1.default)('with no extra charges, landed cost equals base unit cost', () => {
    const result = (0, landed_cost_js_1.allocateLandedCost)([{ itemId: 'a', quantity: 10, unitCost: 100 }], {});
    strict_1.default.equal(result[0].allocatedCharge, 0);
    strict_1.default.equal(result[0].landedUnitCost, 100);
});
(0, node_test_1.default)('VALUE method splits charges proportional to line value, total allocation equals total charges', () => {
    const result = (0, landed_cost_js_1.allocateLandedCost)([
        { itemId: 'cheap', quantity: 10, unitCost: 10 }, // value 100
        { itemId: 'expensive', quantity: 10, unitCost: 90 }, // value 900
    ], { freight: 100, customs: 0, insurance: 0, handling: 0 }, 'VALUE');
    const totalAllocated = result.reduce((sum, row) => sum + row.allocatedCharge, 0);
    strict_1.default.ok(Math.abs(totalAllocated - 100) < 1e-9);
    // expensive line is 9x the value of cheap, so it should absorb 9x the charge
    strict_1.default.ok(Math.abs(result[1].allocatedCharge - result[0].allocatedCharge * 9) < 1e-6);
});
(0, node_test_1.default)('QUANTITY method splits charges evenly per unit regardless of price', () => {
    const result = (0, landed_cost_js_1.allocateLandedCost)([
        { itemId: 'a', quantity: 10, unitCost: 1000 },
        { itemId: 'b', quantity: 10, unitCost: 1 },
    ], { freight: 200 }, 'QUANTITY');
    strict_1.default.equal(result[0].allocatedCharge, result[1].allocatedCharge);
});
(0, node_test_1.default)('WEIGHT method splits charges proportional to total weight', () => {
    const result = (0, landed_cost_js_1.allocateLandedCost)([
        { itemId: 'light', quantity: 1, unitCost: 100, weightKg: 1 },
        { itemId: 'heavy', quantity: 1, unitCost: 100, weightKg: 9 },
    ], { freight: 100 }, 'WEIGHT');
    strict_1.default.ok(Math.abs(result[1].allocatedCharge - result[0].allocatedCharge * 9) < 1e-6);
});
(0, node_test_1.default)('WEIGHT method falls back to value share for a line with no weight recorded', () => {
    const result = (0, landed_cost_js_1.allocateLandedCost)([
        { itemId: 'has-weight', quantity: 1, unitCost: 100, weightKg: 5 },
        { itemId: 'no-weight', quantity: 1, unitCost: 100 },
    ], { freight: 100 }, 'WEIGHT');
    const totalAllocated = result.reduce((sum, row) => sum + row.allocatedCharge, 0);
    strict_1.default.ok(Math.abs(totalAllocated - 100) < 1e-9);
    strict_1.default.ok(result[1].allocatedCharge > 0, 'a line missing weight must still get a share, not be zeroed out');
});
(0, node_test_1.default)('multiple charge types (freight+customs+insurance+handling) sum before allocating', () => {
    const result = (0, landed_cost_js_1.allocateLandedCost)([{ itemId: 'a', quantity: 5, unitCost: 20 }], { freight: 10, customs: 5, insurance: 3, handling: 2 }, 'VALUE');
    strict_1.default.equal(result[0].allocatedCharge, 20);
    strict_1.default.equal(result[0].landedUnitCost, 24);
});
