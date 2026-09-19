"use strict";
// Blueprint v4 §22 supplier master: lead time, MOQ, payment terms,
// brands/categories, contact, and a status that keeps blocked suppliers out of
// new purchase orders.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPLIER_STATUSES = void 0;
exports.parseSupplierFields = parseSupplierFields;
exports.categoriesToList = categoriesToList;
exports.presentSupplier = presentSupplier;
exports.canOrderFrom = canOrderFrom;
exports.SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
const text = (value, max, label) => {
    if (value === undefined)
        return undefined;
    if (value === null || value === '')
        return null;
    if (typeof value !== 'string')
        throw new Error(`${label} must be text.`);
    const trimmed = value.trim();
    if (trimmed.length > max)
        throw new Error(`${label} is limited to ${max} characters.`);
    return trimmed || null;
};
/** Only the keys present in the body are returned, so a partial update never clears a field it did not mention. */
function parseSupplierFields(body, requireName) {
    const fields = {};
    if (body.name !== undefined || requireName) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (name.length < 2)
            throw new Error('Supplier name must be at least 2 characters.');
        fields.name = name;
    }
    const email = text(body.email, 191, 'Email');
    if (email !== undefined) {
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new Error('Enter a valid supplier email address.');
        fields.email = email;
    }
    for (const [key, max, label] of [['phone', 40, 'Phone'], ['contactName', 120, 'Contact name'], ['paymentTerms', 120, 'Payment terms']]) {
        const value = text(body[key], max, label);
        if (value !== undefined)
            fields[key] = value;
    }
    if (body.leadTimeDays !== undefined) {
        if (body.leadTimeDays === null || body.leadTimeDays === '')
            fields.leadTimeDays = null;
        else {
            const days = Number(body.leadTimeDays);
            if (!Number.isInteger(days) || days < 0 || days > 365)
                throw new Error('Lead time must be a whole number of days between 0 and 365.');
            fields.leadTimeDays = days;
        }
    }
    if (body.moq !== undefined) {
        if (body.moq === null || body.moq === '')
            fields.moq = null;
        else {
            const moq = Number(body.moq);
            if (!Number.isFinite(moq) || moq < 0)
                throw new Error('Minimum order quantity must be zero or more.');
            fields.moq = moq;
        }
    }
    if (body.categories !== undefined) {
        const raw = Array.isArray(body.categories) ? body.categories.map(String) : typeof body.categories === 'string' ? body.categories.split(/[,\n]/) : null;
        if (body.categories !== null && raw === null)
            throw new Error('Categories must be a list or comma-separated text.');
        const list = [...new Set((raw ?? []).map((entry) => entry.trim()).filter(Boolean))];
        if (list.some((entry) => entry.length > 60) || list.length > 40)
            throw new Error('Supplier categories are limited to 40 entries of 60 characters.');
        fields.categories = list.length ? list.join('\n') : null;
    }
    if (body.status !== undefined) {
        if (!exports.SUPPLIER_STATUSES.includes(String(body.status)))
            throw new Error('Supplier status must be ACTIVE, INACTIVE or BLOCKED.');
        fields.status = body.status;
    }
    return fields;
}
function categoriesToList(stored) {
    return (stored ?? '').split('\n').map((entry) => entry.trim()).filter(Boolean);
}
/** A supplier row as the API returns it: categories as a list. */
function presentSupplier(row) {
    return { ...row, categories: categoriesToList(row.categories) };
}
function canOrderFrom(status) {
    return !status || status === 'ACTIVE';
}
