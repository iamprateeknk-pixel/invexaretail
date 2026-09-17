"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const access_control_js_1 = require("./access-control.js");
(0, node_test_1.default)('classifies critical API operations', () => {
    strict_1.default.deepEqual((0, access_control_js_1.classifyPermission)('POST', '/imports/batch/reverse'), { module: 'IMPORT', action: 'REVERSE' });
    strict_1.default.deepEqual((0, access_control_js_1.classifyPermission)('PATCH', '/stock-counts/1/review'), { module: 'COUNT', action: 'APPROVE' });
    strict_1.default.deepEqual((0, access_control_js_1.classifyPermission)('GET', '/export/stock'), { module: 'REPORT', action: 'EXPORT' });
    strict_1.default.deepEqual((0, access_control_js_1.classifyPermission)('DELETE', '/locations/1'), { module: 'ADMIN', action: 'DELETE' });
    strict_1.default.deepEqual((0, access_control_js_1.classifyPermission)('POST', '/transfers'), { module: 'TRANSFER', action: 'CREATE' });
});
