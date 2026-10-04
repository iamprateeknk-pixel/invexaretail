"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Audit S-3: the daily sweep marks lapsed AVAILABLE lots EXPIRED (status only, never quantity).
// Skipped unless TEST_DATABASE_URL is set.
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const expiry_sweep_js_1 = require("./expiry-sweep.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
integration('lapsed AVAILABLE lots become EXPIRED; today, future, undated and non-AVAILABLE lots are untouched; quantity never changes', async () => {
    const companyId = `sweep-co-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId } });
    const item = await db_js_1.prisma.item.create({ data: { code: `SWP-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'Sweep item', companyId } });
    const now = new Date('2026-09-26T06:30:00Z'); // 12:00 IST on the 26th
    const mk = (lotNo, expiry, status = 'AVAILABLE') => db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo, status, expiryDate: expiry ? new Date(expiry) : null } });
    const lapsed = await mk('LAPSED', '2026-09-20T00:00:00Z');
    const today = await mk('TODAY', '2026-09-26T00:00:00Z');
    const future = await mk('FUTURE', '2027-01-01T00:00:00Z');
    const undated = await mk('UNDATED', null);
    const blocked = await mk('BLOCKED', '2026-01-01T00:00:00Z', 'BLOCKED');
    const loc = await db_js_1.prisma.location.create({ data: { code: `swp-${(0, node_crypto_1.randomUUID)()}`, name: 'L', type: 'store', companyId } });
    await db_js_1.prisma.stockLedger.create({ data: { itemId: item.id, lotId: lapsed.id, locationId: loc.id, onHand: 7, companyId } });
    const first = await (0, expiry_sweep_js_1.sweepExpiredLots)(now);
    strict_1.default.ok(first.expired >= 1);
    const status = async (id) => (await db_js_1.prisma.lot.findUniqueOrThrow({ where: { id } })).status;
    strict_1.default.equal(await status(lapsed.id), 'EXPIRED');
    strict_1.default.equal(await status(today.id), 'AVAILABLE', 'usable through its expiry date');
    strict_1.default.equal(await status(future.id), 'AVAILABLE');
    strict_1.default.equal(await status(undated.id), 'AVAILABLE');
    strict_1.default.equal(await status(blocked.id), 'BLOCKED', 'a manual block is never overwritten');
    strict_1.default.equal((await db_js_1.prisma.stockLedger.findFirstOrThrow({ where: { lotId: lapsed.id } })).onHand, 7, 'write-off stays a controlled human action');
    const second = await (0, expiry_sweep_js_1.sweepExpiredLots)(now);
    strict_1.default.equal(await status(lapsed.id), 'EXPIRED');
    strict_1.default.ok(second.expired <= first.expired, 'idempotent');
    const next = await (0, expiry_sweep_js_1.sweepExpiredLots)(new Date('2026-09-27T06:30:00Z'));
    strict_1.default.ok(next.expired >= 1);
    strict_1.default.equal(await status(today.id), 'EXPIRED', 'the day after its expiry date it lapses');
});
integration('the sweep judges each lot by its own company\'s timezone (audit T-2)', async () => {
    const mkCompany = async (timezone) => {
        const companyId = `sweeptz-co-${(0, node_crypto_1.randomUUID)()}`;
        await db_js_1.prisma.companyProfile.create({ data: { id: companyId, name: companyId, timezone } });
        const item = await db_js_1.prisma.item.create({ data: { code: `TZ-${(0, node_crypto_1.randomUUID)().slice(0, 8)}`, name: 'TZ item', companyId } });
        const lot = await db_js_1.prisma.lot.create({ data: { itemId: item.id, lotNo: 'L', expiryDate: new Date('2026-09-25T00:00:00Z') } });
        return lot.id;
    };
    const india = await mkCompany('Asia/Kolkata');
    const la = await mkCompany('America/Los_Angeles');
    // 02:00 UTC on the 26th: already the 26th in Kolkata, still the 25th in Los Angeles.
    await (0, expiry_sweep_js_1.sweepExpiredLots)(new Date('2026-09-26T02:00:00Z'));
    const status = async (id) => (await db_js_1.prisma.lot.findUniqueOrThrow({ where: { id } })).status;
    strict_1.default.equal(await status(india), 'EXPIRED');
    strict_1.default.equal(await status(la), 'AVAILABLE', 'the 25th is still usable in Los Angeles');
    await (0, expiry_sweep_js_1.sweepExpiredLots)(new Date('2026-09-26T08:00:00Z')); // 01:00 on the 26th in Los Angeles
    strict_1.default.equal(await status(la), 'EXPIRED');
});
