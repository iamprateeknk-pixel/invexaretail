"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withDistributedLock = withDistributedLock;
const persistence_js_1 = require("./persistence.js");
const db_js_1 = require("./db.js");
/** Postgres session-level advisory locks make timer/worker work safe when Render runs more than one replica. */
async function withDistributedLock(name, work) {
    if (!persistence_js_1.databaseEnabled)
        return work();
    const key = `invexa:${name}`.slice(0, 64);
    const acquired = await (0, db_js_1.queryRaw)(db_js_1.prisma, 'SELECT pg_try_advisory_lock(hashtext(?)::bigint) AS acquired', key);
    if (acquired[0]?.acquired !== true)
        return null;
    try {
        return await work();
    }
    finally {
        await (0, db_js_1.queryRaw)(db_js_1.prisma, 'SELECT pg_advisory_unlock(hashtext(?)::bigint)', key).catch(() => undefined);
    }
}
