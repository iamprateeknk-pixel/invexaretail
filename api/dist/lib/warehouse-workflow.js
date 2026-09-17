"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PICK_EXCEPTION_REASONS = exports.ManualAllocationExceedsAvailableError = exports.LotNotAllocatableError = exports.ManualAllocationRequiresReasonError = void 0;
exports.parseTransferImport = parseTransferImport;
exports.allocateFefo = allocateFefo;
exports.allocateLots = allocateLots;
exports.validatePickInput = validatePickInput;
const stock_import_js_1 = require("./stock-import.js");
const TRANSFER_HEADERS = {
    destinationStore: ['destinationstore', 'destination', 'store', 'branchname', 'location'],
    itemCode: ['itemcode', 'code', 'sku', 'barcode'],
    itemName: ['itemname', 'name', 'productname'],
    requestedQty: ['requestedqty', 'quantity', 'qty', 'transferqty'],
    unit: ['unit', 'packsize', 'pack'],
    remarks: ['remarks', 'remark', 'notes', 'note'],
};
const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const valueText = (value) => String(value ?? '').trim();
async function parseTransferImport(buffer, fileName) {
    const { sheetName, rows } = await (0, stock_import_js_1.readTabularFile)(buffer, fileName);
    let headerIndex = -1;
    let columns = {};
    let mapping = {};
    for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
        const normalized = rows[index].map(normalize);
        const found = {};
        const names = {};
        for (const [field, aliases] of Object.entries(TRANSFER_HEADERS)) {
            const position = normalized.findIndex((header) => aliases.includes(header));
            if (position >= 0) {
                found[field] = position;
                names[field] = valueText(rows[index][position]);
            }
        }
        if (found.requestedQty !== undefined && (found.itemCode !== undefined || found.itemName !== undefined)) {
            headerIndex = index;
            columns = found;
            mapping = names;
            break;
        }
    }
    if (headerIndex < 0)
        throw new Error('Transfer header not found. Item Code or Item Name and Requested Qty are required.');
    const validRows = [];
    const errors = [];
    const seen = new Set();
    let duplicateRows = 0;
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
        const source = rows[index];
        if (!source.some((cell) => valueText(cell)))
            continue;
        const get = (field) => source[columns[field]];
        const itemCode = valueText(get('itemCode')) || undefined;
        const itemName = valueText(get('itemName')) || undefined;
        const requestedQty = Number(valueText(get('requestedQty')).replaceAll(',', ''));
        const rowNumber = index + 1;
        if (!itemCode && !itemName) {
            errors.push({ rowNumber, message: 'Item Code or Item Name is required.' });
            continue;
        }
        if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
            errors.push({ rowNumber, message: 'Requested Qty must be greater than zero.' });
            continue;
        }
        const key = (itemCode || itemName || '').toLowerCase();
        if (seen.has(key))
            duplicateRows += 1;
        seen.add(key);
        validRows.push({
            rowNumber,
            destinationStore: valueText(get('destinationStore')) || undefined,
            itemCode,
            itemName,
            requestedQty,
            unit: valueText(get('unit')) || undefined,
            remarks: valueText(get('remarks')) || undefined,
        });
    }
    return { sheetName, headerRow: headerIndex + 1, totalRows: validRows.length + errors.length, validRows, errors, duplicateRows, mapping };
}
function isAllocatable(lot) {
    return lot.available > 0 && (lot.status ?? 'AVAILABLE') === 'AVAILABLE';
}
function allocateFefo(lots, requestedQty) {
    let remaining = requestedQty;
    const sorted = lots.filter(isAllocatable).sort((a, b) => {
        const aTime = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });
    const allocations = [];
    for (const lot of sorted) {
        if (remaining <= 0)
            break;
        const quantity = Math.min(remaining, lot.available);
        allocations.push({ ...lot, quantity });
        remaining -= quantity;
    }
    return { allocations, shortage: Math.max(0, remaining) };
}
class ManualAllocationRequiresReasonError extends Error {
    constructor() {
        super('A manual lot allocation override requires a reason.');
        this.name = 'ManualAllocationRequiresReasonError';
    }
}
exports.ManualAllocationRequiresReasonError = ManualAllocationRequiresReasonError;
class LotNotAllocatableError extends Error {
    lotId;
    status;
    constructor(lotId, status) {
        super(`Lot ${lotId} cannot be allocated: status is ${status}.`);
        this.lotId = lotId;
        this.status = status;
        this.name = 'LotNotAllocatableError';
    }
}
exports.LotNotAllocatableError = LotNotAllocatableError;
class ManualAllocationExceedsAvailableError extends Error {
    lotId;
    requested;
    available;
    constructor(lotId, requested, available) {
        super(`Manual allocation of ${requested} from lot ${lotId} exceeds ${available} available.`);
        this.lotId = lotId;
        this.requested = requested;
        this.available = available;
        this.name = 'ManualAllocationExceedsAvailableError';
    }
}
exports.ManualAllocationExceedsAvailableError = ManualAllocationExceedsAvailableError;
/**
 * Configurable allocation by category/SKU (blueprint 17): FEFO (default for
 * expiry-controlled inventory), FIFO (oldest lot first by createdAt), or an
 * authorized MANUAL override. A manual override still validates each line
 * against actual availability and against the lot's status — an authorized
 * override can choose which available lots to draw from, but it cannot pull
 * stock that doesn't exist or pull from a blocked/expired/quarantined lot.
 */
function allocateLots(lots, requestedQty, strategy, options) {
    if (strategy === 'MANUAL') {
        if (!options?.overrideReason?.trim())
            throw new ManualAllocationRequiresReasonError();
        const allocations = (options.manualLines ?? []).map((line) => {
            const lot = lots.find((l) => l.lotId === line.lotId);
            if (!lot)
                throw new Error(`Lot ${line.lotId} was not found among the lots available for allocation.`);
            if ((lot.status ?? 'AVAILABLE') !== 'AVAILABLE')
                throw new LotNotAllocatableError(lot.lotId, lot.status ?? 'AVAILABLE');
            if (line.quantity > lot.available)
                throw new ManualAllocationExceedsAvailableError(lot.lotId, line.quantity, lot.available);
            return { ...lot, quantity: line.quantity };
        });
        const allocatedQty = allocations.reduce((sum, a) => sum + a.quantity, 0);
        return { allocations, shortage: Math.max(0, requestedQty - allocatedQty), strategy };
    }
    let remaining = requestedQty;
    const sorted = lots.filter(isAllocatable).sort((a, b) => {
        if (strategy === 'FIFO')
            return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
        const aTime = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    });
    const allocations = [];
    for (const lot of sorted) {
        if (remaining <= 0)
            break;
        const quantity = Math.min(remaining, lot.available);
        allocations.push({ ...lot, quantity });
        remaining -= quantity;
    }
    return { allocations, shortage: Math.max(0, remaining), strategy };
}
exports.PICK_EXCEPTION_REASONS = ['NO_STOCK', 'WRONG_ITEM', 'DAMAGED_ITEM'];
function validatePickInput(input) {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0)
        throw new Error('Picked quantity must be greater than zero.');
    const unit = (input.unit ?? 'PCS').trim().toUpperCase();
    if (unit === 'PCS') {
        if (!Number.isInteger(input.quantity))
            throw new Error('PCS quantity must be a whole number.');
        if (input.inputMethod !== 'SCAN')
            throw new Error('PCS items must be picked by barcode/QR scan.');
        const scan = (input.scanCode ?? '').trim().toLowerCase();
        if (!scan || ![input.itemCode, input.lotNo].some((value) => value.trim().toLowerCase() === scan))
            throw new Error('Wrong Item: scan does not match the requested item or lot.');
    }
    else if (unit === 'KG') {
        if (input.inputMethod !== 'MANUAL')
            throw new Error('KG items use manual decimal entry.');
        if (Math.round(input.quantity * 1000) !== input.quantity * 1000)
            throw new Error('KG quantity supports up to 3 decimal places.');
    }
}
