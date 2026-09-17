"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const picker_js_1 = require("./picker.js");
(0, node_test_1.default)('picker task is scoped to assigned transfers and quantities', () => {
    const task = (0, picker_js_1.buildPickerTask)({
        transferId: 'transfer-1',
        locationId: 'wh-1',
        lines: [{ itemId: 'item-1001', lotId: 'lot-1001', quantity: 12 }],
        assignedPickerId: 'user-picker-1',
        role: 'WAREHOUSE_PICKER',
    });
    strict_1.default.equal(task.locationId, 'wh-1');
    strict_1.default.equal(task.lines[0].quantity, 12);
});
(0, node_test_1.default)('picker task completion validates quantity before close', () => {
    const updated = (0, picker_js_1.completePickerTask)({
        transferId: 'transfer-1',
        pickerId: 'user-picker-1',
        role: 'WAREHOUSE_PICKER',
        pickedQty: 12,
    });
    strict_1.default.equal(updated.status, 'PICKED');
    strict_1.default.equal(updated.pickedQty, 12);
});
