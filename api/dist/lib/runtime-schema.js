"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDailySyncSchema = void 0;
exports.ensureRuntimeSchema = ensureRuntimeSchema;
const db_js_1 = require("./db.js");
let schemaPromise;
/**
 * Verify that the migration-managed PostgreSQL schema is reachable.
 * Application startup never creates or mutates tables at runtime.
 */
function ensureRuntimeSchema() {
    schemaPromise ??= db_js_1.prisma.$queryRaw `SELECT 1`
        .then(() => undefined)
        .catch((error) => {
        schemaPromise = undefined;
        throw error;
    });
    return schemaPromise;
}
exports.ensureDailySyncSchema = ensureRuntimeSchema;
