"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveItemPhoto = saveItemPhoto;
exports.listItemPhotos = listItemPhotos;
exports.readItemPhoto = readItemPhoto;
exports.deleteItemPhoto = deleteItemPhoto;
const db_js_1 = require("./db.js");
const transfer_evidence_js_1 = require("./transfer-evidence.js");
// Blueprint P1 "Item media": multi-image item photos with a primary
// thumbnail. Same FK-free Bytes-column pattern as TransferEvidence - no
// object storage (R2/S3) dependency required to self-host.
async function saveItemPhoto(itemId, uploadedBy, fileName, bytes, makePrimary = false) {
    if (!(0, db_js_1.resolveDatabaseUrl)())
        throw new Error('Durable item photos require a connected database.');
    const mimeType = (0, transfer_evidence_js_1.evidenceMime)(bytes);
    const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
    const existingCount = await db_js_1.prisma.itemPhoto.count({ where: { itemId } });
    const isPrimary = makePrimary || existingCount === 0;
    if (isPrimary) {
        await db_js_1.prisma.itemPhoto.updateMany({ where: { itemId }, data: { isPrimary: false } });
    }
    const row = await db_js_1.prisma.itemPhoto.create({
        data: { itemId, uploadedBy, fileName: safeName, mimeType, byteSize: bytes.length, isPrimary, contents: Uint8Array.from(bytes) },
    });
    return { id: row.id, itemId, fileName: safeName, mimeType, size: bytes.length, isPrimary };
}
async function listItemPhotos(itemId) {
    const rows = await db_js_1.prisma.itemPhoto.findMany({
        where: { itemId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, itemId: true, fileName: true, mimeType: true, byteSize: true, isPrimary: true, createdAt: true },
    });
    return rows.map((row) => ({ ...row, size: row.byteSize }));
}
async function readItemPhoto(itemId, id) {
    const row = await db_js_1.prisma.itemPhoto.findFirst({ where: { itemId, id }, select: { mimeType: true, contents: true } });
    return row ? { mimeType: row.mimeType, contents: row.contents } : undefined;
}
async function deleteItemPhoto(itemId, id) {
    await db_js_1.prisma.itemPhoto.deleteMany({ where: { itemId, id } });
    const remainingPrimary = await db_js_1.prisma.itemPhoto.count({ where: { itemId, isPrimary: true } });
    if (remainingPrimary === 0) {
        const next = await db_js_1.prisma.itemPhoto.findFirst({ where: { itemId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (next)
            await db_js_1.prisma.itemPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
}
