"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const dashboard_js_1 = require("./dashboard.js");
(0, node_test_1.default)('dashboard summary calculates admin KPI cards from seeded data', () => {
    const summary = (0, dashboard_js_1.buildDashboardSummary)({
        counts: [{ id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', physicalQuantity: 10, bookQty: 10, mode: 'scan', submittedBy: 'u1', role: 'STORE_USER', createdAt: new Date().toISOString() }],
        transfers: [{ id: 't1', sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', requestedBy: 'u2', role: 'ADMIN', status: 'REQUESTED', lines: [{ itemId: 'i1', lotId: 'l1', quantity: 4 }], createdAt: new Date().toISOString() }],
        items: [
            { id: 'i1', code: 'SKU-1', name: 'Rice', lots: [{ id: 'l1', itemId: 'i1', lotNo: 'LOT-1', expiryDate: new Date(Date.now() + 8 * 86400000).toISOString(), attributes: {} }] },
            { id: 'i2', code: 'SKU-2', name: 'Milk', lots: [{ id: 'l2', itemId: 'i2', lotNo: 'LOT-2', expiryDate: new Date(Date.now() + 40 * 86400000).toISOString(), attributes: {} }] },
            { id: 'i3', code: 'SKU-3', name: 'Soap', lots: [{ id: 'l3', itemId: 'i3', lotNo: 'LOT-3', expiryDate: new Date(Date.now() - 5 * 86400000).toISOString(), attributes: {} }] },
        ],
    });
    strict_1.default.equal(summary.pendingCounts, 1);
    strict_1.default.equal(summary.transferRequests, 1);
    strict_1.default.equal(summary.expiredTillDate, 1);
    strict_1.default.equal(summary.countCompletionPercent, 0);
    strict_1.default.equal(summary.stockAccuracyPercent, 100);
    strict_1.default.equal(summary.transferSlaPercent, 0);
});
(0, node_test_1.default)('report summary groups numbers for store and warehouse operations', () => {
    const report = (0, dashboard_js_1.buildReportSummary)({
        locationId: 'loc-1',
        counts: [{ id: 'c1', itemId: 'i1', lotId: 'l1', locationId: 'loc-1', physicalQuantity: 10, bookQty: 10, mode: 'scan', submittedBy: 'u1', role: 'STORE_USER', createdAt: new Date().toISOString() }],
        transfers: [{ id: 't1', sourceLocationId: 'loc-1', destinationLocationId: 'wh-1', requestedBy: 'u2', role: 'ADMIN', status: 'RECEIVED', lines: [{ itemId: 'i1', lotId: 'l1', quantity: 4 }], createdAt: new Date().toISOString() }],
    });
    strict_1.default.equal(report.totalCounts, 1);
    strict_1.default.equal(report.totalTransfers, 1);
    strict_1.default.equal(report.locationId, 'loc-1');
});
