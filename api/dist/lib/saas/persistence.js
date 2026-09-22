"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureControlPlaneSchema = ensureControlPlaneSchema;
exports.loadControlPlaneSnapshot = loadControlPlaneSnapshot;
exports.saveControlPlaneSnapshot = saveControlPlaneSnapshot;
exports.hydrateControlPlaneFromStore = hydrateControlPlaneFromStore;
exports.scheduleControlPlanePersist = scheduleControlPlanePersist;
exports.flushControlPlanePersist = flushControlPlanePersist;
const db_js_1 = require("../db.js");
const control_plane_js_1 = require("./control-plane.js");
const snapshot_js_1 = require("./snapshot.js");
function databaseEnabled() {
    if (process.env.NODE_TEST_CONTEXT && process.env.CONTROL_PLANE_PERSIST_IN_TESTS !== '1') {
        return false;
    }
    return Boolean((0, db_js_1.resolveDatabaseUrl)());
}
let persistTimer;
let persistInFlight;
function asJsonPayload(snapshot) {
    return JSON.parse(JSON.stringify(snapshot));
}
// ADR-003: ControlPlaneState is a Prisma model; `prisma migrate deploy` owns
// its schema. No-op kept so existing call sites do not need to change.
async function ensureControlPlaneSchema() { }
async function loadControlPlaneSnapshot() {
    if (!databaseEnabled())
        return null;
    const { prisma } = await import('../db.js');
    const row = await prisma.controlPlaneState.findUnique({
        where: { id: snapshot_js_1.CONTROL_PLANE_STATE_ID },
    });
    if (!row)
        return null;
    const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return (0, snapshot_js_1.isControlPlaneSnapshot)(parsed) ? parsed : null;
}
async function saveControlPlaneSnapshot(snapshot = (0, snapshot_js_1.serializeControlPlane)(control_plane_js_1.controlPlane)) {
    if (!databaseEnabled())
        return;
    const { prisma } = await import('../db.js');
    const payload = asJsonPayload(snapshot);
    await prisma.controlPlaneState.upsert({
        where: { id: snapshot_js_1.CONTROL_PLANE_STATE_ID },
        create: { id: snapshot_js_1.CONTROL_PLANE_STATE_ID, payload },
        update: { payload },
    });
}
async function hydrateControlPlaneFromStore() {
    if (!databaseEnabled())
        return 'skipped';
    try {
        await ensureControlPlaneSchema();
        const snapshot = await loadControlPlaneSnapshot();
        if (!snapshot) {
            await saveControlPlaneSnapshot();
            return 'seeded';
        }
        (0, snapshot_js_1.applyControlPlaneSnapshot)(control_plane_js_1.controlPlane, snapshot);
        return 'restored';
    }
    catch (error) {
        console.warn('SaaS control plane state could not be hydrated; continuing with in-memory seed.', error instanceof Error ? error.message : error);
        return 'skipped';
    }
}
function scheduleControlPlanePersist() {
    if (!databaseEnabled())
        return;
    if (persistTimer)
        clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = undefined;
        persistInFlight = saveControlPlaneSnapshot().catch((error) => {
            console.warn('SaaS control plane state could not be saved.', error instanceof Error ? error.message : error);
        });
    }, 250);
}
async function flushControlPlanePersist() {
    if (!databaseEnabled())
        return;
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = undefined;
        await saveControlPlaneSnapshot();
        return;
    }
    if (persistInFlight)
        await persistInFlight;
}
