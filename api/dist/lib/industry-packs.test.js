"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const industry_packs_js_1 = require("./industry-packs.js");
(0, node_test_1.default)('resolveIndustryKey always returns grocery for this deployment', () => {
    strict_1.default.equal((0, industry_packs_js_1.resolveIndustryKey)('pharmacy'), 'grocery');
    strict_1.default.equal((0, industry_packs_js_1.resolveIndustryKey)('electronics'), 'grocery');
    strict_1.default.equal((0, industry_packs_js_1.resolveIndustryKey)('supermarket'), 'grocery');
    strict_1.default.equal((0, industry_packs_js_1.resolveIndustryKey)(''), 'grocery');
});
(0, node_test_1.default)('missingPackSeeds is idempotent by case-insensitive name', () => {
    const created = (0, industry_packs_js_1.missingPackSeeds)(['Fresh', 'chilled'], [
        { name: 'Fresh' },
        { name: 'Frozen' },
        { name: 'CHILLED' },
    ]);
    strict_1.default.deepEqual(created.map((row) => row.name), ['Frozen']);
});
(0, node_test_1.default)('grocery pack matches Invexa item/lot model: FEFO, expiry, seed categories', () => {
    const pack = (0, industry_packs_js_1.getIndustryPack)();
    const view = (0, industry_packs_js_1.toWorkspacePackView)(pack);
    const workflow = (0, industry_packs_js_1.workflowFromPack)(pack);
    strict_1.default.equal(pack.key, 'grocery');
    strict_1.default.equal(view.modules.expiry, true);
    strict_1.default.equal(view.modules.assets, false);
    strict_1.default.ok(pack.categories.includes('Staples'));
    strict_1.default.ok(pack.categories.includes('Dairy'));
    strict_1.default.ok(pack.categories.includes('Household'));
    strict_1.default.ok(pack.units.includes('bag'));
    strict_1.default.equal(workflow.allocationStrategy, 'FEFO');
    strict_1.default.equal(workflow.expiryBlocking, false);
});
