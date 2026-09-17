"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchImportLocation = matchImportLocation;
exports.parseDailyStockImport = parseDailyStockImport;
const stock_import_js_1 = require("./stock-import.js");
const aliases = {
    lineNo: ['sno', 'sno', 'serialno', 'lineno', 'line'],
    locationName: ['branchname', 'branch', 'store', 'storelocation', 'location', 'partyname', 'receivinglocation'],
    billDate: ['billdate', 'invoicedate', 'receiptdate', 'grndate', 'date'],
    billTime: ['billtime', 'invoicetime', 'receipttime', 'time'],
    reference: ['billno', 'invoiceno', 'invoicenumber', 'grnno', 'grnnumber', 'receiptno', 'transactionid'],
    itemCode: ['itemcode', 'code', 'sku', 'barcode'],
    itemName: ['itemname', 'productname', 'name'],
    unit: ['packsize', 'packgrade', 'packsizegrade', 'unit', 'pack'],
    quantity: ['totalqty', 'quantity', 'qty', 'qtyreceived', 'quantityreceived', 'returnqty'],
    returnQty: ['salesreturnqty', 'returnqty', 'returnedqty'],
    lotNo: ['lotno', 'lotnumber', 'batch', 'batchno'],
    rate: ['rate', 'rateunit', 'rateperunit'],
    amount: ['grossamount', 'netamount', 'billamount', 'amount'],
    transactionType: ['transactiontype', 'type', 'salestype', 'returntype'],
    rowSource: ['rowsource', 'rowsourceref', 'datasource', 'sourcesystem'],
};
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
function matchImportLocation(sourceName, locations) {
    const source = norm(sourceName);
    if (!source)
        return undefined;
    const exact = locations.filter((location) => norm(location.name) === source);
    if (exact.length === 1)
        return exact[0];
    const aliases = locations.filter((location) => {
        const candidate = norm(location.name);
        return candidate.length >= 4 && (source.endsWith(candidate) || candidate.endsWith(source));
    });
    return aliases.length === 1 ? aliases[0] : undefined;
}
const value = (input) => String(input ?? '').trim();
const numeric = (input) => {
    if (typeof input === 'number')
        return Number.isFinite(input) ? input : undefined;
    const result = Number(value(input).replaceAll(',', ''));
    return Number.isFinite(result) ? result : undefined;
};
function dateAt(dateValue, timeValue, fallbackTime) {
    const date = value(dateValue);
    const time = value(timeValue);
    const match = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match)
        return { assumed: !time };
    let clock = time || fallbackTime || '12:00';
    const twelve = clock.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (twelve) {
        let hour = Number(twelve[1]) % 12;
        if (twelve[4].toUpperCase() === 'PM')
            hour += 12;
        clock = `${String(hour).padStart(2, '0')}:${twelve[2]}:${twelve[3] ?? '00'}`;
    }
    else if (/^\d{1,2}:\d{2}$/.test(clock))
        clock = `${clock}:00`;
    const iso = new Date(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}T${clock}+05:30`);
    return Number.isNaN(iso.getTime()) ? { assumed: !time } : { at: iso.toISOString(), assumed: !time };
}
function findHeader(rows, kind) {
    for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
        const headers = rows[index].map(norm);
        const columns = {};
        const mapping = {};
        for (const [field, choices] of Object.entries(aliases)) {
            const found = headers.findIndex((header) => choices.includes(header));
            if (found >= 0) {
                columns[field] = found;
                mapping[field] = value(rows[index][found]);
            }
        }
        if (columns.billDate !== undefined && columns.reference !== undefined && columns.itemName !== undefined && columns.quantity !== undefined && (kind === 'PURCHASE' || columns.locationName !== undefined))
            return { index, columns, mapping };
    }
    return undefined;
}
async function parseDailyStockImport(buffer, fileName, kind, options) {
    const { sheetName, rows } = await (0, stock_import_js_1.readTabularFile)(buffer, fileName);
    const header = findHeader(rows, kind);
    if (!header)
        throw new Error(kind === 'SALES' ? 'Sales sheet must include Branch Name, Bill Date, Bill No., Item Name and Total Qty.' : 'Purchase sheet must include Bill Date, Bill No., Item Name and Total Qty.');
    const validRows = [];
    const errors = [];
    const duplicates = [];
    const seen = new Set();
    for (let index = header.index + 1; index < rows.length; index += 1) {
        const source = rows[index];
        if (!source.some((cell) => value(cell)))
            continue;
        const get = (field) => source[header.columns[field]];
        const itemName = value(get('itemName'));
        const reference = value(get('reference'));
        const qty = numeric(get('quantity'));
        const sourceLineNo = value(get('lineNo'));
        const rowNumber = index + 1;
        // Keep the source line number as-is. Only fall back to the Excel row when
        // the sheet has no line column, so two distinct lines of the same bill are
        // not collapsed into one duplicate.
        const dedupeLine = sourceLineNo || String(rowNumber);
        if (/^(date totals|grand totals)$/i.test(itemName) || /^(date totals|grand totals)$/i.test(value(get('billDate'))))
            continue;
        if (!itemName || !reference || qty === undefined || qty === 0) {
            errors.push({ rowNumber, message: 'Bill/GRN No., Item Name and non-zero Total Qty are required.' });
            continue;
        }
        const date = dateAt(get('billDate'), kind === 'SALES' ? get('billTime') : undefined, options.purchaseTime ?? '12:00');
        if (!date.at) {
            errors.push({ rowNumber, message: 'Bill/receipt date or time is invalid.' });
            continue;
        }
        const locationName = kind === 'PURCHASE' ? options.purchaseLocationName : value(get('locationName'));
        if (!locationName) {
            errors.push({ rowNumber, message: 'Branch Name is required for sales.' });
            continue;
        }
        const typeText = value(get('transactionType'));
        const returnQty = numeric(get('returnQty'));
        const isReturn = kind === 'SALES' && (qty < 0 || (returnQty ?? 0) > 0 || /return|credit|sales\s*return/i.test(`${typeText} ${reference}`));
        const quantity = Math.abs(returnQty && returnQty > 0 ? returnQty : qty);
        const movementType = kind === 'PURCHASE' ? 'PURCHASE_IN' : isReturn ? 'SALES_RETURN' : 'SALE_OUT';
        const rowSource = value(get('rowSource')) || undefined;
        const dedupeKey = `${kind}|${norm(locationName)}|${norm(reference)}|${norm(value(get('itemCode')) || itemName)}|${norm(dedupeLine)}|${movementType}`;
        if (seen.has(dedupeKey)) {
            duplicates.push({ rowNumber, dedupeKey, message: `Duplicate of source reference ${reference} / line ${dedupeLine}.` });
            continue;
        }
        seen.add(dedupeKey);
        validRows.push({ rowNumber, locationName, reference, lineNo: sourceLineNo || String(rowNumber), itemCode: value(get('itemCode')) || undefined, itemName, unit: value(get('unit')) || undefined, quantity, lotNo: value(get('lotNo')) || undefined, transactionAt: date.at, movementType, dedupeKey, rate: numeric(get('rate')), amount: numeric(get('amount')), timeAssumed: date.assumed, rowSource });
    }
    const dates = validRows.map((row) => row.transactionAt).sort();
    return { importType: kind, sheetName, headerRow: header.index + 1, totalRows: validRows.length + errors.length + duplicates.length, validRows, errors, duplicates, duplicateRows: duplicates.length, mapping: header.mapping, transactionFrom: dates[0], transactionTo: dates.at(-1) };
}
