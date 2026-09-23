"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withDistributedLock = withDistributedLock;
const persistence_js_1 = require("./persistence.js");
const db_js_1 = require("./db.js");
/** PostgreSQL advisory locks make timer/worker work safe across replicas. */
async function withDistributedLock(name, work) {
    if (!persistence_js_1.databaseEnabled)
        return work();
    const key = `invexa:${name}`;
    const acquired = await db_js_1.prisma.$queryRawUnsafe('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', key);
    if (acquired[0]?.acquired !== true)
        return null;
    try {
        return await work();
    }
    finally {
        await db_js_1.prisma.$queryRawUnsafe('SELECT pg_advisory_unlock(hashtextextended($1, 0))', key).catch(() => undefined);
    }
}
