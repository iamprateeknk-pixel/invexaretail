"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const kill_switch_js_1 = require("./kill-switch.js");
(0, node_test_1.default)('inventory, WMS and OMS paths map to killable features', () => {
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/items'), 'INVENTORY');
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/stock/loc-1'), 'INVENTORY');
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/counts'), 'INVENTORY');
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/transfers'), 'WMS');
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/waves/pick'), 'WMS');
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/orders'), 'OMS');
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/auth/login'), null);
    strict_1.default.equal((0, kill_switch_js_1.featureForOperationalPath)('/users'), null);
});
