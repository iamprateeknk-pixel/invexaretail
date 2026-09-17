"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const mobile_role_js_1 = require("./mobile-role.js");
(0, node_test_1.default)('warehouse pickers get pick/putaway/scan instead of the generic count tab', () => {
    const home = (0, mobile_role_js_1.mobileHomeForRole)('WAREHOUSE_PICKER');
    strict_1.default.deepEqual(home.destinations.map((d) => d.id), ['home', 'pick', 'putaway', 'scan']);
    strict_1.default.equal(home.defaultDestination, 'pick');
});
(0, node_test_1.default)('store users get count + receive, not warehouse picking', () => {
    const home = (0, mobile_role_js_1.mobileHomeForRole)('STORE_USER');
    strict_1.default.deepEqual(home.destinations.map((d) => d.id), ['home', 'count', 'receive', 'stock']);
    strict_1.default.equal(home.destinations.some((d) => d.id === 'pick'), false);
});
(0, node_test_1.default)('admins keep network tabs including channel orders', () => {
    strict_1.default.ok((0, mobile_role_js_1.mobileHomeForRole)('ADMIN').destinations.some((d) => d.id === 'orders'));
    strict_1.default.equal((0, mobile_role_js_1.mobileHomeForRole)('AUDITOR').destinations.some((d) => d.id === 'transfers'), false);
});
(0, node_test_1.default)('offline queue covers counts, transfers, receiving, picking, putaway, exceptions and QC', () => {
    strict_1.default.deepEqual([...mobile_role_js_1.OFFLINE_ACTION_TYPES], ['COUNT', 'TRANSFER_REQUEST', 'TRANSFER_RECEIVE', 'PICK', 'PUTAWAY', 'EXCEPTION', 'QC_INSPECTION']);
    strict_1.default.equal((0, mobile_role_js_1.offlineActionSpec)('PUTAWAY').endpoint.includes('putaway-tasks'), true);
    strict_1.default.equal((0, mobile_role_js_1.offlineActionSpec)('TRANSFER_RECEIVE').method, 'POST');
});
