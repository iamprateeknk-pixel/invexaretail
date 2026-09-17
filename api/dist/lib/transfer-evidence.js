"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evidenceMime = evidenceMime;
exports.saveTransferEvidence = saveTransferEvidence;
exports.listTransferEvidence = listTransferEvidence;
exports.readTransferEvidence = readTransferEvidence;
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
function evidenceMime(bytes) {
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024)
        throw new Error('Photo must be between 1 byte and 5 MB.');
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        return 'image/jpeg';
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP')
        return 'image/webp';
    throw new Error('Only JPEG, PNG and WebP photos are supported.');
}
let schema;
async function ensureSchema() {
    if (!(0, db_js_1.resolveDatabaseUrl)())
        throw new Error('Durable evidence requires a connected MySQL database.');
    schema ??= db_js_1.prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS TransferEvidence (id VARCHAR(191) PRIMARY KEY, transferId VARCHAR(191) NOT NULL, fileName VARCHAR(191) NOT NULL, mimeType VARCHAR(64) NOT NULL, byteSize INT NOT NULL, uploadedBy VARCHAR(191) NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), contents LONGBLOB NOT NULL, INDEX TransferEvidence_transfer_idx (transferId))').catch((error) => { schema = undefined; throw error; });
    await schema;
}
async function saveTransferEvidence(transferId, uploadedBy, fileName, bytes) {
    const mimeType = evidenceMime(bytes);
    await ensureSchema();
    const id = (0, node_crypto_1.randomUUID)();
    const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
    await db_js_1.prisma.$executeRawUnsafe('INSERT INTO TransferEvidence (id, transferId, fileName, mimeType, byteSize, uploadedBy, contents) VALUES (?, ?, ?, ?, ?, ?, ?)', id, transferId, safeName, mimeType, bytes.length, uploadedBy, bytes);
    return { id, transferId, fileName: safeName, mimeType, size: bytes.length };
}
async function listTransferEvidence(transferId) {
    await ensureSchema();
    return db_js_1.prisma.$queryRawUnsafe('SELECT id, transferId, fileName, mimeType, byteSize AS size, createdAt FROM TransferEvidence WHERE transferId = ? ORDER BY createdAt', transferId);
}
async function readTransferEvidence(transferId, id) {
    await ensureSchema();
    const rows = await db_js_1.prisma.$queryRawUnsafe('SELECT mimeType, contents FROM TransferEvidence WHERE transferId = ? AND id = ?', transferId, id);
    return rows[0];
}
