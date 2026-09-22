"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDailySyncSchema = ensureDailySyncSchema;
/**
 * ADR-003: schema evolution runs exclusively through `prisma migrate deploy`
 * now that the database is Postgres with a real deploy pipeline (see
 * render.yaml's preDeployCommand and docker-compose's api entrypoint). Every
 * table this used to hand-create with MySQL DDL is a Prisma model already.
 * Kept as a no-op so existing call sites do not need to change.
 */
async function ensureDailySyncSchema() { }
