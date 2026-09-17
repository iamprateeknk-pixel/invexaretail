"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JAIPUR_ITEM_ID = exports.JAIPUR_LOCATION_ID = exports.JAIPUR_COMPANY_ID = exports.PLAN_PRICES = exports.DEFAULT_TENANT_ID = exports.DEFAULT_COMPANY_ID = void 0;
exports.seedDefaultTenantOwnership = seedDefaultTenantOwnership;
exports.ensureJaipurOperationalWorkspace = ensureJaipurOperationalWorkspace;
exports.registerLocationCompany = registerLocationCompany;
exports.registerItemCompany = registerItemCompany;
exports.adoptHydratedOwnership = adoptHydratedOwnership;
exports.ownerOfLocation = ownerOfLocation;
exports.ownerOfItem = ownerOfItem;
exports.companyOwnsLocation = companyOwnsLocation;
exports.companyOwnsItem = companyOwnsItem;
exports.locationsForCompany = locationsForCompany;
exports.itemsForCompany = itemsForCompany;
exports.enforceOperationalCompanyScope = enforceOperationalCompanyScope;
const repository_js_1 = require("../repository.js");
const seed_js_1 = require("../seed.js");
exports.DEFAULT_COMPANY_ID = 'default-company';
exports.DEFAULT_TENANT_ID = 'tenant-invexa';
exports.PLAN_PRICES = { starter: 0, pro: 4999, enterprise: 19999 };
exports.JAIPUR_COMPANY_ID = 'company-jaipur';
exports.JAIPUR_LOCATION_ID = 'loc-jaipur-1';
exports.JAIPUR_ITEM_ID = 'item-jaipur-1';
const locationOwners = new Map();
const itemOwners = new Map();
const LOCATION_KEYS = ['locationId', 'sourceLocationId', 'destinationLocationId', 'fromLocationId', 'toLocationId'];
const ITEM_KEYS = ['itemId'];
function seedDefaultTenantOwnership() {
    for (const location of seed_js_1.seedLocations)
        locationOwners.set(location.id, exports.DEFAULT_COMPANY_ID);
    for (const item of seed_js_1.seedItems)
        itemOwners.set(item.id, exports.DEFAULT_COMPANY_ID);
}
function ensureJaipurOperationalWorkspace() {
    registerLocationCompany(exports.JAIPUR_LOCATION_ID, exports.JAIPUR_COMPANY_ID);
    registerItemCompany(exports.JAIPUR_ITEM_ID, exports.JAIPUR_COMPANY_ID);
    if (process.env.DATABASE_URL)
        return;
    if (!repository_js_1.locations.some((location) => location.id === exports.JAIPUR_LOCATION_ID)) {
        repository_js_1.locations.push({ id: exports.JAIPUR_LOCATION_ID, name: 'Jaipur Store', type: 'store' });
    }
    if (!repository_js_1.items.some((item) => item.id === exports.JAIPUR_ITEM_ID)) {
        repository_js_1.items.push({
            id: exports.JAIPUR_ITEM_ID,
            code: 'SKU-JPR-1',
            name: 'Jaipur Namkeen 200g',
            category: 'Snacks',
            unit: 'pack',
            lots: [{
                    id: 'lot-jaipur-1',
                    itemId: exports.JAIPUR_ITEM_ID,
                    lotNo: 'JPR-01',
                    expiryDate: '2027-06-30',
                    attributes: { source: 'seed' },
                }],
        });
    }
    if (!repository_js_1.stockLedger.some((row) => row.locationId === exports.JAIPUR_LOCATION_ID && row.itemId === exports.JAIPUR_ITEM_ID)) {
        repository_js_1.stockLedger.push({
            itemId: exports.JAIPUR_ITEM_ID,
            lotId: 'lot-jaipur-1',
            locationId: exports.JAIPUR_LOCATION_ID,
            onHand: 18,
            quarantine: 0,
            version: 0,
        });
    }
}
seedDefaultTenantOwnership();
ensureJaipurOperationalWorkspace();
function registerLocationCompany(locationId, companyId) {
    if (!locationId)
        return;
    locationOwners.set(locationId, companyId || exports.DEFAULT_COMPANY_ID);
}
function registerItemCompany(itemId, companyId) {
    if (!itemId)
        return;
    itemOwners.set(itemId, companyId || exports.DEFAULT_COMPANY_ID);
}
function adoptHydratedOwnership(input) {
    locationOwners.clear();
    itemOwners.clear();
    seedDefaultTenantOwnership();
    for (const location of input.locations)
        registerLocationCompany(location.id, location.companyId || exports.DEFAULT_COMPANY_ID);
    for (const item of input.items)
        registerItemCompany(item.id, item.companyId || exports.DEFAULT_COMPANY_ID);
    ensureJaipurOperationalWorkspace();
}
function ownerOfLocation(locationId) {
    return locationOwners.get(locationId);
}
function ownerOfItem(itemId) {
    return itemOwners.get(itemId);
}
function companyOwnsLocation(companyId, locationId) {
    const owner = ownerOfLocation(locationId);
    return Boolean(owner && owner === companyId);
}
function companyOwnsItem(companyId, itemId) {
    const owner = ownerOfItem(itemId);
    return Boolean(owner && owner === companyId);
}
function locationsForCompany(companyId, rows) {
    return rows.filter((row) => companyOwnsLocation(companyId, row.id));
}
function itemsForCompany(companyId, rows) {
    return rows.filter((row) => companyOwnsItem(companyId, row.id));
}
function firstString(value) {
    if (Array.isArray(value))
        return firstString(value[0]);
    return typeof value === 'string' ? value : '';
}
function collectIds(req, keys) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const found = [];
    for (const key of keys) {
        for (const value of [req.params[key], req.query[key], body[key]]) {
            const id = firstString(value);
            if (id)
                found.push(id);
        }
    }
    return found;
}
function enforceOperationalCompanyScope(req, res, next) {
    const companyId = req.companyId;
    if (!companyId) {
        next();
        return;
    }
    const ids = [
        ...collectIds(req, LOCATION_KEYS),
        ...collectIds(req, ITEM_KEYS),
        ...String(req.path ?? '').split('/').filter(Boolean),
    ];
    for (const locationId of ids) {
        if (ownerOfLocation(locationId) && !companyOwnsLocation(companyId, locationId)) {
            res.status(403).json({ error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
            return;
        }
    }
    for (const itemId of ids) {
        if (ownerOfItem(itemId) && !companyOwnsItem(companyId, itemId)) {
            res.status(403).json({ error: 'Company scope mismatch', code: 'COMPANY_SCOPE_MISMATCH' });
            return;
        }
    }
    next();
}
