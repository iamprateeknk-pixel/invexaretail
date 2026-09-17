"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDUSTRY_PACKS = exports.INDUSTRY_KEYS = void 0;
exports.listIndustryCatalog = listIndustryCatalog;
exports.isIndustryKey = isIndustryKey;
exports.resolveIndustryKey = resolveIndustryKey;
exports.getIndustryPack = getIndustryPack;
exports.toWorkspacePackView = toWorkspacePackView;
exports.getActiveWorkflow = getActiveWorkflow;
exports.setActiveWorkflow = setActiveWorkflow;
exports.workflowFromPack = workflowFromPack;
exports.missingPackSeeds = missingPackSeeds;
exports.isSerialFieldName = isSerialFieldName;
exports.applyIndustryPack = applyIndustryPack;
exports.hydrateActiveWorkflow = hydrateActiveWorkflow;
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const databaseEnabled = Boolean((0, db_js_1.resolveDatabaseUrl)());
exports.INDUSTRY_KEYS = ['grocery'];
exports.INDUSTRY_PACKS = {
    grocery: {
        key: 'grocery',
        label: 'Grocery',
        description: 'Invexa grocery operations: lot/expiry stock, FEFO transfers, blind counts and branch replenishment.',
        hide: ['assets'],
        dashboardKpis: ['expiry_risk', 'low_stock', 'pending_counts', 'transfers', 'discrepancy', 'pending_approvals'],
        allocationStrategy: 'FEFO',
        expiryBlocking: false,
        tags: [
            { name: 'Fresh', color: 'emerald' },
            { name: 'Chilled', color: 'cyan' },
            { name: 'Frozen', color: 'blue' },
        ],
        customFields: [
            { name: 'Storage temperature', type: 'select', options: ['Ambient', 'Chilled', 'Frozen'] },
            { name: 'Perishable', type: 'boolean' },
        ],
        categories: ['Staples', 'Dairy', 'Household', 'Produce', 'Bakery', 'Frozen', 'Grocery'],
        units: ['bag', 'pack', 'box', 'KG', 'PCS'],
    },
};
let activeWorkflow = workflowFromPack(exports.INDUSTRY_PACKS.grocery);
function listIndustryCatalog() {
    return exports.INDUSTRY_KEYS.map((key) => exports.INDUSTRY_PACKS[key]);
}
function isIndustryKey(value) {
    return typeof value === 'string' && exports.INDUSTRY_KEYS.includes(value);
}
function resolveIndustryKey(_value) {
    return 'grocery';
}
function getIndustryPack(key) {
    return exports.INDUSTRY_PACKS[resolveIndustryKey(key)];
}
function toWorkspacePackView(pack) {
    const hidden = new Set(pack.hide);
    return {
        key: pack.key,
        label: pack.label,
        description: pack.description,
        hide: pack.hide,
        dashboardKpis: pack.dashboardKpis,
        allocationStrategy: pack.allocationStrategy,
        expiryBlocking: pack.expiryBlocking,
        modules: {
            expiry: !hidden.has('expiry'),
            assets: !hidden.has('assets'),
            jobs: !hidden.has('jobs'),
            catalog: true,
            purchaseOrders: true,
        },
        categories: pack.categories,
        units: pack.units,
        variantFields: pack.variantFields ?? [],
        serialFieldNames: pack.serialFieldNames ?? [],
    };
}
function getActiveWorkflow() {
    return { ...activeWorkflow };
}
function setActiveWorkflow(update) {
    activeWorkflow = { ...update };
    return getActiveWorkflow();
}
function workflowFromPack(pack) {
    return {
        allocationStrategy: pack.allocationStrategy,
        expiryBlocking: pack.expiryBlocking,
        fefoEnforced: pack.allocationStrategy === 'FEFO',
        industryKey: pack.key,
    };
}
function missingPackSeeds(existingNames, seeds) {
    const seen = new Set([...existingNames].map((name) => name.trim().toLowerCase()));
    return seeds.filter((seed) => !seen.has(seed.name.trim().toLowerCase()));
}
function isSerialFieldName(fieldName, pack = getIndustryPack(activeWorkflow.industryKey)) {
    const haystack = fieldName.trim().toLowerCase();
    if (pack.serialFieldNames?.some((name) => name.toLowerCase() === haystack))
        return true;
    return /imei|serial/.test(haystack);
}
async function applyIndustryPack(industryKey) {
    const pack = getIndustryPack(industryKey);
    setActiveWorkflow(workflowFromPack(pack));
    if (!databaseEnabled)
        return { createdTags: 0, createdFields: 0 };
    const [existingTags, existingFields] = await Promise.all([
        db_js_1.prisma.tag.findMany({ select: { name: true } }),
        db_js_1.prisma.customFieldDefinition.findMany({ select: { name: true } }),
    ]);
    const tagsToCreate = missingPackSeeds(existingTags.map((row) => row.name), pack.tags);
    const fieldsToCreate = missingPackSeeds(existingFields.map((row) => row.name), pack.customFields);
    if (tagsToCreate.length) {
        await db_js_1.prisma.tag.createMany({
            data: tagsToCreate.map((tag) => ({ id: (0, node_crypto_1.randomUUID)(), name: tag.name, color: tag.color })),
            skipDuplicates: true,
        });
    }
    for (const [index, field] of fieldsToCreate.entries()) {
        await db_js_1.prisma.customFieldDefinition.create({
            data: {
                id: (0, node_crypto_1.randomUUID)(),
                name: field.name,
                type: field.type,
                options: field.options,
                required: Boolean(field.required),
                sortOrder: existingFields.length + index,
            },
        });
    }
    await db_js_1.prisma.workflowConfiguration.upsert({
        where: { type_scopeId: { type: 'INVENTORY', scopeId: 'default' } },
        update: {
            fefoEnforced: pack.allocationStrategy === 'FEFO',
            expiryBlocking: pack.expiryBlocking,
            config: {
                industryKey: pack.key,
                allocationStrategy: pack.allocationStrategy,
            },
        },
        create: {
            id: (0, node_crypto_1.randomUUID)(),
            type: 'INVENTORY',
            scopeId: 'default',
            fefoEnforced: pack.allocationStrategy === 'FEFO',
            expiryBlocking: pack.expiryBlocking,
            config: {
                industryKey: pack.key,
                allocationStrategy: pack.allocationStrategy,
            },
        },
    }).catch(() => undefined);
    for (const moduleName of ['expiry', 'assets', 'jobs']) {
        const enabled = !pack.hide.includes(moduleName);
        await db_js_1.prisma.featureFlag.upsert({
            where: { name: `module.${moduleName}` },
            update: { enabled, config: { industryKey: pack.key } },
            create: {
                id: (0, node_crypto_1.randomUUID)(),
                name: `module.${moduleName}`,
                enabled,
                description: `${pack.label} ${moduleName} module`,
                config: { industryKey: pack.key },
            },
        }).catch(() => undefined);
    }
    return { createdTags: tagsToCreate.length, createdFields: fieldsToCreate.length };
}
async function hydrateActiveWorkflow(industryKey) {
    const pack = getIndustryPack(industryKey);
    const fallback = workflowFromPack(pack);
    if (!databaseEnabled) {
        return setActiveWorkflow(fallback);
    }
    const row = await db_js_1.prisma.workflowConfiguration.findUnique({
        where: { type_scopeId: { type: 'INVENTORY', scopeId: 'default' } },
    }).catch(() => null);
    if (!row)
        return setActiveWorkflow(fallback);
    return setActiveWorkflow({
        allocationStrategy: pack.allocationStrategy,
        expiryBlocking: pack.expiryBlocking,
        fefoEnforced: pack.allocationStrategy === 'FEFO',
        industryKey: pack.key,
    });
}
