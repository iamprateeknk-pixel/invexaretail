"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const warehouse_workflow_js_1 = require("./warehouse-workflow.js");
(0, node_test_1.default)('transfer import accepts minimal item name and quantity files', async () => {
    const preview = await (0, warehouse_workflow_js_1.parseTransferImport)(Buffer.from('Item Name,Requested Qty,Remarks\nAlmond,12.5,Urgent\n'), 'transfer.csv');
    strict_1.default.equal(preview.validRows.length, 1);
    strict_1.default.equal(preview.validRows[0].requestedQty, 12.5);
});
(0, node_test_1.default)('FEFO allocation can fulfil one item from multiple lots', () => {
    const result = (0, warehouse_workflow_js_1.allocateFefo)([
        { lotId: 'b', lotNo: 'B', expiryDate: '2026-11-15', available: 15 },
        { lotId: 'c', lotNo: 'C', expiryDate: '2027-01-20', available: 20 },
        { lotId: 'a', lotNo: 'A', expiryDate: '2026-10-10', available: 10 },
    ], 30);
    strict_1.default.deepEqual(result.allocations.map((row) => [row.lotNo, row.quantity]), [['A', 10], ['B', 15], ['C', 5]]);
    strict_1.default.equal(result.shortage, 0);
});
(0, node_test_1.default)('allocateFefo excludes expired, blocked and quarantined lots from allocation', () => {
    const result = (0, warehouse_workflow_js_1.allocateFefo)([
        { lotId: 'exp', lotNo: 'EXP', expiryDate: '2026-01-01', available: 20, status: 'EXPIRED' },
        { lotId: 'blk', lotNo: 'BLK', expiryDate: '2026-02-01', available: 20, status: 'BLOCKED' },
        { lotId: 'qtn', lotNo: 'QTN', expiryDate: '2026-03-01', available: 20, status: 'QUARANTINE' },
        { lotId: 'ok', lotNo: 'OK', expiryDate: '2026-12-01', available: 20, status: 'AVAILABLE' },
    ], 15);
    strict_1.default.deepEqual(result.allocations.map((a) => a.lotNo), ['OK']);
    strict_1.default.equal(result.allocations[0].quantity, 15);
    strict_1.default.equal(result.shortage, 0);
});
(0, node_test_1.default)('allocateLots with FIFO strategy picks the oldest lot by createdAt regardless of expiry', () => {
    const result = (0, warehouse_workflow_js_1.allocateLots)([
        { lotId: 'new', lotNo: 'NEW', createdAt: '2026-06-01', expiryDate: '2026-07-01', available: 10 },
        { lotId: 'old', lotNo: 'OLD', createdAt: '2026-01-01', expiryDate: '2027-01-01', available: 10 },
    ], 10, 'FIFO');
    strict_1.default.deepEqual(result.allocations.map((a) => a.lotNo), ['OLD']);
    strict_1.default.equal(result.strategy, 'FIFO');
});
(0, node_test_1.default)('allocateLots MANUAL override requires a reason', () => {
    const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'AVAILABLE' }];
    strict_1.default.throws(() => (0, warehouse_workflow_js_1.allocateLots)(lots, 5, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 5 }] }), warehouse_workflow_js_1.ManualAllocationRequiresReasonError);
    strict_1.default.doesNotThrow(() => (0, warehouse_workflow_js_1.allocateLots)(lots, 5, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 5 }], overrideReason: 'Customer requested this batch' }));
});
(0, node_test_1.default)('allocateLots MANUAL override cannot draw from a blocked or expired lot', () => {
    const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'BLOCKED' }];
    strict_1.default.throws(() => (0, warehouse_workflow_js_1.allocateLots)(lots, 5, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 5 }], overrideReason: 'Testing' }), warehouse_workflow_js_1.LotNotAllocatableError);
});
(0, node_test_1.default)('allocateLots MANUAL override cannot exceed the lot\'s actual availability', () => {
    const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'AVAILABLE' }];
    strict_1.default.throws(() => (0, warehouse_workflow_js_1.allocateLots)(lots, 50, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 50 }], overrideReason: 'Testing' }), warehouse_workflow_js_1.ManualAllocationExceedsAvailableError);
});
(0, node_test_1.default)('allocateLots reports shortage when even manual lines cannot cover the request', () => {
    const lots = [{ lotId: 'a', lotNo: 'A', available: 10, status: 'AVAILABLE' }];
    const result = (0, warehouse_workflow_js_1.allocateLots)(lots, 30, 'MANUAL', { manualLines: [{ lotId: 'a', quantity: 10 }], overrideReason: 'Partial fulfilment approved' });
    strict_1.default.equal(result.shortage, 20);
});
(0, node_test_1.default)('PCS requires a matching scan and KG allows 3 decimal manual entry', () => {
    strict_1.default.throws(() => (0, warehouse_workflow_js_1.validatePickInput)({ unit: 'PCS', quantity: 1, inputMethod: 'MANUAL', itemCode: 'DF001', lotNo: 'L1' }), /scan/i);
    strict_1.default.throws(() => (0, warehouse_workflow_js_1.validatePickInput)({ unit: 'PCS', quantity: 1, inputMethod: 'SCAN', scanCode: 'OTHER', itemCode: 'DF001', lotNo: 'L1' }), /Wrong Item/);
    strict_1.default.doesNotThrow(() => (0, warehouse_workflow_js_1.validatePickInput)({ unit: 'KG', quantity: 12.375, inputMethod: 'MANUAL', itemCode: 'DF001', lotNo: 'L1' }));
    strict_1.default.throws(() => (0, warehouse_workflow_js_1.validatePickInput)({ unit: 'KG', quantity: 1.2345, inputMethod: 'MANUAL', itemCode: 'DF001', lotNo: 'L1' }), /3 decimal/);
});
