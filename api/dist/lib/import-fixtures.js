"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSalesCsv = buildSalesCsv;
exports.salesCsvBuffer = salesCsvBuffer;
function buildSalesCsv(rowCount, options) {
    const branchName = options?.branchName ?? 'Main Store';
    const itemCode = options?.itemCode ?? 'SKU-1001';
    const itemName = options?.itemName ?? 'Rice 5kg';
    const quantity = options?.quantity ?? 0.01;
    const includeLineNo = options?.includeLineNo ?? true;
    const rowSource = options?.rowSource ?? 'ERP';
    const headers = includeLineNo
        ? ['S_No.', 'BRANCH NAME', 'BILL DATE', 'BILL TIME', 'BILL NO.', 'ITEM CODE', 'ITEM NAME', 'LOT NO.', 'UNIT', 'TOTAL QTY', 'ROW SOURCE']
        : ['BRANCH NAME', 'BILL DATE', 'BILL TIME', 'BILL NO.', 'ITEM CODE', 'ITEM NAME', 'LOT NO.', 'UNIT', 'TOTAL QTY', 'ROW SOURCE'];
    const lines = [headers.join(',')];
    for (let index = 1; index <= rowCount; index += 1) {
        const cells = [
            includeLineNo ? String(index) : undefined,
            branchName,
            '11/09/2026',
            '10:18 AM',
            `DGR-${index}`,
            itemCode,
            itemName,
            'LOT-01',
            'KG',
            String(quantity),
            rowSource,
        ].filter((cell) => cell !== undefined);
        lines.push(cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','));
    }
    return lines.join('\n');
}
function salesCsvBuffer(rowCount, options) {
    return Buffer.from(buildSalesCsv(rowCount, options));
}
