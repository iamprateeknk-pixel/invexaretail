"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withDistributedLock = withDistributedLock;
const persistence_js_1 = require("./persistence.js");
const db_js_1 = require("./db.js");
/** MySQL advisory locks make timer/worker work safe when Render runs more than one replica. */
async function withDistributedLock(name, work) {
    if (!persistence_js_1.databaseEnabled)
        return work();
    const key = `invexa:${name}`.slice(0, 64);
    const acquired = await db_js_1.prisma.$queryRawUnsafe('SELECT GET_LOCK(?, 0) AS acquired', key);
    if (Number(acquired[0]?.acquired ?? 0) !== 1)
        return null;
    try {
        return await work();
    }
    finally {
        await db_js_1.prisma.$queryRawUnsafe('SELECT RELEASE_LOCK(?)', key).catch(() => undefined);
    }
}
