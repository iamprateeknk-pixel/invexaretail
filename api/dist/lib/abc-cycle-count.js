"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABC_CADENCE = exports.ABC_THRESHOLDS = exports.ABC_CLASSES = void 0;
exports.parseAbcClasses = parseAbcClasses;
exports.addDaysIso = addDaysIso;
exports.classifyAbcClass = classifyAbcClass;
exports.classifyAbcItems = classifyAbcItems;
exports.aggregateLocationStock = aggregateLocationStock;
exports.buildCycleCountPlan = buildCycleCountPlan;
exports.selectEligibleCycleCountItems = selectEligibleCycleCountItems;
exports.cycleCountInstructions = cycleCountInstructions;
const expiry_board_js_1 = require("./expiry-board.js");
exports.ABC_CLASSES = ['A', 'B', 'C'];
exports.ABC_THRESHOLDS = { A: 0.8, B: 0.95 };
exports.ABC_CADENCE = {
    A: { abcClass: 'A', dueInDays: 7, priority: 'HIGH', label: 'Weekly' },
    B: { abcClass: 'B', dueInDays: 30, priority: 'NORMAL', label: 'Monthly' },
    C: { abcClass: 'C', dueInDays: 90, priority: 'LOW', label: 'Quarterly' },
};
function isAbcClass(value) {
    return exports.ABC_CLASSES.includes(value);
}
function parseAbcClasses(value) {
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        return ['A'];
    }
    if (!Array.isArray(value)) {
        throw new Error('classes must be an array of A, B, or C.');
    }
    const selected = new Set(value
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim().toUpperCase())
        .filter(isAbcClass));
    const classes = exports.ABC_CLASSES.filter((abcClass) => selected.has(abcClass));
    if (classes.length === 0) {
        throw new Error('classes must include A, B, or C.');
    }
    return classes;
}
function addDaysIso(now, days) {
    return new Date(now.getTime() + days * 86_400_000).toISOString();
}
function classifyAbcClass(cumulativeBefore) {
    if (cumulativeBefore < exports.ABC_THRESHOLDS.A)
        return 'A';
    if (cumulativeBefore < exports.ABC_THRESHOLDS.B)
        return 'B';
    return 'C';
}
function classifyAbcItems(rows) {
    const ranked = [...rows].sort((left, right) => {
        if (right.extendedValue !== left.extendedValue)
            return right.extendedValue - left.extendedValue;
        return left.itemId.localeCompare(right.itemId);
    });
    const totalValue = ranked.reduce((sum, row) => sum + row.extendedValue, 0);
    const classified = new Map();
    let cumulative = 0;
    for (const row of ranked) {
        const abcClass = totalValue <= 0 ? 'C' : classifyAbcClass(cumulative / totalValue);
        cumulative += row.extendedValue;
        classified.set(row.itemId, {
            abcClass,
            share: totalValue <= 0 ? 0 : row.extendedValue / totalValue,
            cumulativeShare: totalValue <= 0 ? 0 : cumulative / totalValue,
        });
    }
    return classified;
}
function aggregateLocationStock(items, stock) {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const byItem = new Map();
    for (const row of stock) {
        if (row.onHand <= 0)
            continue;
        const item = itemMap.get(row.itemId);
        if (!item)
            continue;
        const lot = item.lots.find((candidate) => candidate.id === row.lotId);
        const purchaseValue = (0, expiry_board_js_1.estimateLotValue)(lot?.attributes, row.onHand);
        const source = purchaseValue === null ? 'qty_proxy' : 'purchase';
        const current = byItem.get(row.itemId) ?? { onHand: 0, extendedValue: 0, sources: new Set() };
        current.onHand += row.onHand;
        current.extendedValue += purchaseValue ?? row.onHand;
        current.sources.add(source);
        byItem.set(row.itemId, current);
    }
    return [...byItem.entries()]
        .map(([itemId, totals]) => {
        const item = itemMap.get(itemId);
        const valueSource = totals.sources.size > 1 ? 'mixed' : [...totals.sources][0] ?? 'qty_proxy';
        return {
            itemId,
            code: item.code,
            name: item.name,
            onHand: totals.onHand,
            extendedValue: totals.extendedValue,
            valueSource,
        };
    })
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
}
function buildCycleCountPlan(input) {
    const now = input.now ?? new Date();
    const locationStock = input.stock.filter((row) => row.locationId === input.locationId);
    const aggregated = aggregateLocationStock(input.items, locationStock);
    const classified = classifyAbcItems(aggregated);
    const assignedItemIds = new Set(input.assignments
        .filter((assignment) => assignment.locationId === input.locationId && assignment.status === 'ASSIGNED')
        .map((assignment) => assignment.itemId));
    const planItems = aggregated
        .map((row) => {
        const abc = classified.get(row.itemId);
        const cadence = exports.ABC_CADENCE[abc.abcClass];
        const assigned = assignedItemIds.has(row.itemId);
        return {
            ...row,
            abcClass: abc.abcClass,
            share: abc.share,
            cumulativeShare: abc.cumulativeShare,
            dueInDays: cadence.dueInDays,
            priority: cadence.priority,
            dueDate: addDaysIso(now, cadence.dueInDays),
            assigned,
            eligible: !assigned,
        };
    })
        .sort((left, right) => {
        if (right.extendedValue !== left.extendedValue)
            return right.extendedValue - left.extendedValue;
        return left.itemId.localeCompare(right.itemId);
    });
    const emptyClass = (abcClass) => ({
        count: 0,
        eligible: 0,
        assigned: 0,
        onHand: 0,
        value: 0,
        dueInDays: exports.ABC_CADENCE[abcClass].dueInDays,
        priority: exports.ABC_CADENCE[abcClass].priority,
    });
    const summary = {
        A: emptyClass('A'),
        B: emptyClass('B'),
        C: emptyClass('C'),
    };
    for (const item of planItems) {
        const bucket = summary[item.abcClass];
        bucket.count += 1;
        bucket.onHand += item.onHand;
        bucket.value += item.extendedValue;
        if (item.assigned)
            bucket.assigned += 1;
        if (item.eligible)
            bucket.eligible += 1;
    }
    return {
        locationId: input.locationId,
        generatedAt: now.toISOString(),
        totalValue: planItems.reduce((sum, item) => sum + item.extendedValue, 0),
        summary,
        items: planItems,
    };
}
function selectEligibleCycleCountItems(items, options) {
    const classSet = new Set(options.classes ?? ['A']);
    const idSet = options.itemIds && options.itemIds.length > 0 ? new Set(options.itemIds) : null;
    return items.filter((item) => item.eligible && classSet.has(item.abcClass) && (!idSet || idSet.has(item.itemId)));
}
function cycleCountInstructions(abcClass) {
    const cadence = exports.ABC_CADENCE[abcClass];
    return `ABC cycle count · class ${abcClass} · ${cadence.label.toLowerCase()}`;
}
