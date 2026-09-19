"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const supplier_master_js_1 = require("./supplier-master.js");
(0, node_test_1.default)('a supplier needs a name and valid terms; only the fields given are returned on update', () => {
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({}, true), /at least 2 characters/);
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({ name: 'A' }, false), /at least 2 characters/);
    strict_1.default.deepEqual((0, supplier_master_js_1.parseSupplierFields)({ leadTimeDays: 5 }, false), { leadTimeDays: 5 });
    strict_1.default.deepEqual((0, supplier_master_js_1.parseSupplierFields)({ name: ' Fresh Foods ', moq: '12', paymentTerms: 'Net 30', leadTimeDays: '4' }, true), { name: 'Fresh Foods', moq: 12, paymentTerms: 'Net 30', leadTimeDays: 4 });
    strict_1.default.deepEqual((0, supplier_master_js_1.parseSupplierFields)({ moq: null, contactName: '' }, false), { moq: null, contactName: null });
});
(0, node_test_1.default)('bad lead time, MOQ, email or status are refused', () => {
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({ leadTimeDays: 2.5 }, false), /whole number/);
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({ leadTimeDays: 400 }, false), /between 0 and 365/);
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({ moq: -1 }, false), /zero or more/);
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({ email: 'nope' }, false), /valid supplier email/);
    strict_1.default.throws(() => (0, supplier_master_js_1.parseSupplierFields)({ status: 'GONE' }, false), /ACTIVE, INACTIVE or BLOCKED/);
});
(0, node_test_1.default)('categories are stored once each and presented as a list; a blocked supplier cannot be ordered from', () => {
    const fields = (0, supplier_master_js_1.parseSupplierFields)({ categories: 'Dairy, Grocery,\nDairy,  ' }, false);
    strict_1.default.equal(fields.categories, 'Dairy\nGrocery');
    strict_1.default.deepEqual((0, supplier_master_js_1.categoriesToList)(fields.categories), ['Dairy', 'Grocery']);
    strict_1.default.deepEqual((0, supplier_master_js_1.presentSupplier)({ id: 's', categories: 'A\nB' }).categories, ['A', 'B']);
    strict_1.default.deepEqual((0, supplier_master_js_1.presentSupplier)({ id: 's', categories: null }).categories, []);
    strict_1.default.deepEqual((0, supplier_master_js_1.parseSupplierFields)({ categories: [' A ', 'B'] }, false), { categories: 'A\nB' });
    strict_1.default.equal((0, supplier_master_js_1.canOrderFrom)('ACTIVE'), true);
    strict_1.default.equal((0, supplier_master_js_1.canOrderFrom)(undefined), true);
    strict_1.default.equal((0, supplier_master_js_1.canOrderFrom)('BLOCKED'), false);
});
