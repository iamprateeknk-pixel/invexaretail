"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeFileChecksum = computeFileChecksum;
exports.findDuplicateBatch = findDuplicateBatch;
// Week 11: file/content checksum for import idempotency. A duplicate
// upload of the same file (same bytes) must never create a second batch
// and re-post the same movements - this is the guard for that, checked
// before an ImportBatch row is even created.
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
function computeFileChecksum(content) {
    return (0, node_crypto_1.createHash)('sha256').update(content).digest('hex');
}
/**
 * A duplicate is the same checksum, same type, same tenant. Different
 * tenants uploading byte-identical files (e.g. a shared vendor template)
 * are not duplicates of each other - each company's import history is its
 * own.
 */
async function findDuplicateBatch(companyId, type, fileChecksum) {
    return db_js_1.prisma.importBatch.findFirst({
        where: { companyId, type, fileHash: fileChecksum, status: { not: 'FAILED' } },
        orderBy: { importedAt: 'desc' },
    });
}
