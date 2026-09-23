"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveItemPhoto = saveItemPhoto;
exports.listItemPhotos = listItemPhotos;
exports.readItemPhoto = readItemPhoto;
exports.deleteItemPhoto = deleteItemPhoto;
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const transfer_evidence_js_1 = require("./transfer-evidence.js");
function requireDatabase() {
    if (!(0, db_js_1.resolveDatabaseUrl)())
        throw new Error('Durable item photos require a connected PostgreSQL database.');
}
async function saveItemPhoto(itemId, uploadedBy, fileName, bytes, makePrimary = false) {
    requireDatabase();
    const id = (0, node_crypto_1.randomUUID)();
    const mimeType = (0, transfer_evidence_js_1.evidenceMime)(bytes);
    const safeName = fileName.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 191) || 'photo';
    const existing = await db_js_1.prisma.itemPhoto.count({ where: { itemId } });
    const isPrimary = makePrimary || existing === 0;
    await db_js_1.prisma.$transaction(async (tx) => {
        if (isPrimary)
            await tx.itemPhoto.updateMany({ where: { itemId }, data: { isPrimary: false } });
        await tx.itemPhoto.create({
            data: { id, itemId, uploadedBy, fileName: safeName, mimeType, byteSize: bytes.length, isPrimary, contents: new Uint8Array(bytes) },
        });
    });
    return { id, itemId, fileName: safeName, mimeType, size: bytes.length, isPrimary };
}
async function listItemPhotos(itemId) {
    requireDatabase();
    const rows = await db_js_1.prisma.itemPhoto.findMany({
        where: { itemId },
        select: { id: true, itemId: true, fileName: true, mimeType: true, byteSize: true, isPrimary: true, createdAt: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(({ byteSize, ...row }) => ({ ...row, size: byteSize }));
}
async function readItemPhoto(itemId, id) {
    requireDatabase();
    return db_js_1.prisma.itemPhoto.findFirst({ where: { itemId, id }, select: { mimeType: true, contents: true } });
}
async function deleteItemPhoto(itemId, id) {
    requireDatabase();
    await db_js_1.prisma.$transaction(async (tx) => {
        await tx.itemPhoto.deleteMany({ where: { itemId, id } });
        const primary = await tx.itemPhoto.findFirst({ where: { itemId, isPrimary: true }, select: { id: true } });
        if (!primary) {
            const next = await tx.itemPhoto.findFirst({ where: { itemId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
            if (next)
                await tx.itemPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
    });
}
