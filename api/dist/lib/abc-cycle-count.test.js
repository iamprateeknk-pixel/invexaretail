"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const abc_cycle_count_js_1 = require("./abc-cycle-count.js");
const seed_js_1 = require("./seed.js");
const now = new Date('2026-09-14T12:00:00.000Z');
(0, node_test_1.default)('Pareto cut-offs put the crossing item in the class being filled', () => {
    strict_1.default.equal((0, abc_cycle_count_js_1.classifyAbcClass)(0), 'A');
    strict_1.default.equal((0, abc_cycle_count_js_1.classifyAbcClass)(0.799), 'A');
    strict_1.default.equal((0, abc_cycle_count_js_1.classifyAbcClass)(0.8), 'B');
    strict_1.default.equal((0, abc_cycle_count_js_1.classifyAbcClass)(0.949), 'B');
    strict_1.default.equal((0, abc_cycle_count_js_1.classifyAbcClass)(0.95), 'C');
});
(0, node_test_1.default)('classes default to A and reject unknown values', () => {
    strict_1.default.deepEqual((0, abc_cycle_count_js_1.parseAbcClasses)(undefined), ['A']);
    strict_1.default.deepEqual((0, abc_cycle_count_js_1.parseAbcClasses)([]), ['A']);
    strict_1.default.deepEqual((0, abc_cycle_count_js_1.parseAbcClasses)(['c', 'A', 'A', 'nope']), ['A', 'C']);
    strict_1.default.throws(() => (0, abc_cycle_count_js_1.parseAbcClasses)('A'), /array of A, B, or C/);
    strict_1.default.throws(() => (0, abc_cycle_count_js_1.parseAbcClasses)(['Z']), /include A, B, or C/);
});
(0, node_test_1.default)('seed loc-1 stock ranks yoghurt and bread as A, rice and milk as B, flour as C', () => {
    const aggregated = (0, abc_cycle_count_js_1.aggregateLocationStock)(seed_js_1.seedItems, seed_js_1.seedStockLedger.filter((row) => row.locationId === 'loc-1'));
    const byId = Object.fromEntries(aggregated.map((row) => [row.itemId, row]));
    strict_1.default.equal(byId['item-1004'].extendedValue, 180);
    strict_1.default.equal(byId['item-1005'].extendedValue, 90);
    strict_1.default.equal(byId['item-1001'].extendedValue, 28);
    strict_1.default.equal(byId['item-1001'].valueSource, 'qty_proxy');
    strict_1.default.equal(byId['item-1004'].valueSource, 'purchase');
    const classified = (0, abc_cycle_count_js_1.classifyAbcItems)(aggregated);
    strict_1.default.equal(classified.get('item-1004')?.abcClass, 'A');
    strict_1.default.equal(classified.get('item-1005')?.abcClass, 'A');
    strict_1.default.equal(classified.get('item-1001')?.abcClass, 'B');
    strict_1.default.equal(classified.get('item-1002')?.abcClass, 'B');
    strict_1.default.equal(classified.get('item-1006')?.abcClass, 'C');
});
(0, node_test_1.default)('cycle-count plan applies cadence and skips items already ASSIGNED', () => {
    const plan = (0, abc_cycle_count_js_1.buildCycleCountPlan)({
        locationId: 'loc-1',
        items: seed_js_1.seedItems,
        stock: seed_js_1.seedStockLedger,
        assignments: [
            {
                id: 'assign-rice',
                locationId: 'loc-1',
                itemId: 'item-1001',
                assignedToId: 'user-store-1',
                assignedById: 'user-admin-1',
                countDate: now.toISOString(),
                status: 'ASSIGNED',
                createdAt: now.toISOString(),
            },
        ],
        now,
    });
    strict_1.default.equal(plan.items.length, 5);
    strict_1.default.equal(plan.summary.A.count, 2);
    strict_1.default.equal(plan.summary.B.assigned, 1);
    strict_1.default.equal(plan.summary.B.eligible, 1);
    strict_1.default.equal(plan.items[0].itemId, 'item-1004');
    strict_1.default.equal(plan.items[0].priority, 'HIGH');
    strict_1.default.equal(plan.items[0].dueDate, (0, abc_cycle_count_js_1.addDaysIso)(now, 7));
    const rice = plan.items.find((item) => item.itemId === 'item-1001');
    strict_1.default.equal(rice?.assigned, true);
    strict_1.default.equal(rice?.eligible, false);
    strict_1.default.equal(rice?.priority, 'NORMAL');
    strict_1.default.equal(rice?.dueDate, (0, abc_cycle_count_js_1.addDaysIso)(now, abc_cycle_count_js_1.ABC_CADENCE.B.dueInDays));
    const flour = plan.items.find((item) => item.itemId === 'item-1006');
    strict_1.default.equal(flour?.abcClass, 'C');
    strict_1.default.equal(flour?.priority, 'LOW');
    const classA = (0, abc_cycle_count_js_1.selectEligibleCycleCountItems)(plan.items, { classes: ['A'] });
    strict_1.default.deepEqual(classA.map((item) => item.itemId), ['item-1004', 'item-1005']);
    const skippedRice = (0, abc_cycle_count_js_1.selectEligibleCycleCountItems)(plan.items, { classes: ['B'], itemIds: ['item-1001'] });
    strict_1.default.equal(skippedRice.length, 0);
});
(0, node_test_1.default)('zero-stock locations produce an empty plan', () => {
    const plan = (0, abc_cycle_count_js_1.buildCycleCountPlan)({
        locationId: 'loc-empty',
        items: seed_js_1.seedItems,
        stock: [],
        assignments: [],
        now,
    });
    strict_1.default.equal(plan.items.length, 0);
    strict_1.default.equal(plan.totalValue, 0);
    strict_1.default.equal(plan.summary.A.count, 0);
});
