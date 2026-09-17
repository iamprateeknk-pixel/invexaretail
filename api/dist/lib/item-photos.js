"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveItemPhoto = saveItemPhoto;
exports.listItemPhotos = listItemPhotos;
exports.readItemPhoto = readItemPhoto;
exports.deleteItemPhoto = deleteItemPhoto;
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const transfer_evidence_js_1 = require("./transfer-evidence.js");
// Blueprint P1 "Item media": multi-image item photos with a primary
// thumbnail. Same FK-free LONGBLOB pattern as TransferEvidence - no object
// storage (R2/S3) dependency, self-heals on Hostinger shared MySQL.
let schema;
async function ensureSchema() {
    if (!(0, db_js_1.resolveDatabaseUrl)())
        throw new Error('Durable item photos require a connected MySQL database.');
    schema ??= db_js_1.prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS ItemPhoto (id VARCHAR(191) PRIMARY KEY, itemId VARCHAR(191) NOT NULL, fileName VARCHAR(191) NOT NULL, mimeType VARCHAR(64) NOT NULL, byteSize INT NOT NULL, isPrimary TINYINT(1) NOT NULL DEFAULT 0, uploadedBy VARCHAR(191) NOT NULL, createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), contents LONGBLOB NOT NULL, INDEX ItemPhoto_item_idx (itemId))').catch((error) => { schema = undefined; throw error; });
    await schema;
}
async function saveItemPhoto(itemId, uploadedBy, fileName, bytes, makePrimary = false) {
    const mimeType = (0, transfer_evidence_js_1.evidenceMime)(bytes);
    await ensureSchema();
    const id = (0, node_crypto_1.randomUUID)();
    const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
    const existing = await db_js_1.prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM ItemPhoto WHERE itemId = ?', itemId);
    const isFirst = Number(existing[0]?.count ?? 0) === 0;
    const isPrimary = makePrimary || isFirst;
    if (isPrimary) {
        await db_js_1.prisma.$executeRawUnsafe('UPDATE ItemPhoto SET isPrimary = 0 WHERE itemId = ?', itemId);
    }
    await db_js_1.prisma.$executeRawUnsafe('INSERT INTO ItemPhoto (id, itemId, fileName, mimeType, byteSize, isPrimary, uploadedBy, contents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, itemId, safeName, mimeType, bytes.length, isPrimary ? 1 : 0, uploadedBy, bytes);
    return { id, itemId, fileName: safeName, mimeType, size: bytes.length, isPrimary };
}
async function listItemPhotos(itemId) {
    await ensureSchema();
    return db_js_1.prisma.$queryRawUnsafe('SELECT id, itemId, fileName, mimeType, byteSize AS size, isPrimary, createdAt FROM ItemPhoto WHERE itemId = ? ORDER BY isPrimary DESC, createdAt', itemId);
}
async function readItemPhoto(itemId, id) {
    await ensureSchema();
    const rows = await db_js_1.prisma.$queryRawUnsafe('SELECT mimeType, contents FROM ItemPhoto WHERE itemId = ? AND id = ?', itemId, id);
    return rows[0];
}
async function deleteItemPhoto(itemId, id) {
    await ensureSchema();
    await db_js_1.prisma.$executeRawUnsafe('DELETE FROM ItemPhoto WHERE itemId = ? AND id = ?', itemId, id);
    const remaining = await db_js_1.prisma.$queryRawUnsafe('SELECT id FROM ItemPhoto WHERE itemId = ? AND isPrimary = 1', itemId);
    if (remaining.length === 0) {
        const next = await db_js_1.prisma.$queryRawUnsafe('SELECT id FROM ItemPhoto WHERE itemId = ? ORDER BY createdAt LIMIT 1', itemId);
        if (next[0])
            await db_js_1.prisma.$executeRawUnsafe('UPDATE ItemPhoto SET isPrimary = 1 WHERE id = ?', next[0].id);
    }
}
