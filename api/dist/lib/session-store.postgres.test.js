"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// DB-mode coverage for lib/session-store.ts (ADR-003). Skipped unless
// TEST_DATABASE_URL is set - see AGENTS.md "Required tests": this file must
// be run directly against a real Postgres instance, not folded into the
// default in-memory `npm test` run (session-store.test.ts covers that path).
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const node_crypto_1 = require("node:crypto");
const db_js_1 = require("./db.js");
const session_store_js_1 = require("./session-store.js");
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? node_test_1.default : node_test_1.default.skip;
async function makeUser() {
    const id = `session-test-${(0, node_crypto_1.randomUUID)()}`;
    await db_js_1.prisma.user.create({
        data: {
            id,
            name: 'Session Store Test User',
            email: `${id}@test.invexa.local`,
            passwordHash: 'not-a-real-hash',
            role: 'ADMIN',
            assignedLocations: '[]',
        },
    });
    return id;
}
integration('refresh rotation is persisted in UserSession, not just in-process state', async () => {
    const userId = await makeUser();
    const issued = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    const beforeRotate = await db_js_1.prisma.userSession.findMany({ where: { familyId: issued.familyId } });
    strict_1.default.equal(beforeRotate.length, 1);
    strict_1.default.equal(beforeRotate[0].status, 'ACTIVE');
    const rotated = await (0, session_store_js_1.rotateRefreshToken)(issued.token);
    strict_1.default.equal(rotated.ok, true);
    const afterRotate = await db_js_1.prisma.userSession.findMany({ where: { familyId: issued.familyId }, orderBy: { createdAt: 'asc' } });
    strict_1.default.equal(afterRotate.length, 2);
    strict_1.default.equal(afterRotate[0].status, 'ROTATED');
    strict_1.default.equal(afterRotate[1].status, 'ACTIVE');
    strict_1.default.equal(afterRotate[0].replacedByTokenHash, afterRotate[1].tokenHash);
});
integration('replaying a rotated token revokes the whole family in the database', async () => {
    const userId = await makeUser();
    const issued = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    await (0, session_store_js_1.rotateRefreshToken)(issued.token);
    const replay = await (0, session_store_js_1.rotateRefreshToken)(issued.token);
    strict_1.default.deepEqual(replay, { ok: false, reason: 'reused' });
    const rows = await db_js_1.prisma.userSession.findMany({ where: { familyId: issued.familyId } });
    strict_1.default.ok(rows.every((row) => row.status === 'REVOKED'));
});
integration('revoke-all ends every session family for the user in the database', async () => {
    const userId = await makeUser();
    const familyA = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    const familyB = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    await (0, session_store_js_1.revokeAllSessionsForUser)(userId);
    const rows = await db_js_1.prisma.userSession.findMany({ where: { userId } });
    strict_1.default.ok(rows.length >= 2);
    strict_1.default.ok(rows.every((row) => row.status === 'REVOKED'));
    strict_1.default.equal((await (0, session_store_js_1.rotateRefreshToken)(familyA.token)).ok, false);
    strict_1.default.equal((await (0, session_store_js_1.rotateRefreshToken)(familyB.token)).ok, false);
});
integration('logout revokes only the presented family, not the whole account, in the database', async () => {
    const userId = await makeUser();
    const familyA = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    const familyB = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    await (0, session_store_js_1.revokeRefreshFamily)(familyA.token);
    strict_1.default.equal((await (0, session_store_js_1.rotateRefreshToken)(familyA.token)).ok, false);
    strict_1.default.equal((await (0, session_store_js_1.rotateRefreshToken)(familyB.token)).ok, true);
});
integration('two "replicas" racing to rotate the same token: exactly one wins, per the database', async () => {
    const userId = await makeUser();
    const issued = await (0, session_store_js_1.createRefreshFamily)(userId, 'default-company');
    const [a, b] = await Promise.all([(0, session_store_js_1.rotateRefreshToken)(issued.token), (0, session_store_js_1.rotateRefreshToken)(issued.token)]);
    const outcomes = [a.ok, b.ok].sort();
    strict_1.default.deepEqual(outcomes, [false, true]);
    const rows = await db_js_1.prisma.userSession.findMany({ where: { familyId: issued.familyId } });
    // The race loser's reuse handling revokes the family, including the winner's freshly-issued row.
    strict_1.default.ok(rows.every((row) => row.status === 'REVOKED'));
});
integration('OTP challenges are persisted hashed, never in plaintext, and consumed atomically', async () => {
    const email = `otp-${(0, node_crypto_1.randomUUID)()}@test.invexa.local`;
    const code = await (0, session_store_js_1.createOtpChallenge)(email, 'LOGIN');
    const stored = await db_js_1.prisma.otpChallenge.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
    strict_1.default.ok(stored);
    strict_1.default.notEqual(stored.codeHash, code);
    const first = await (0, session_store_js_1.verifyOtpChallenge)(email, code, 'LOGIN');
    strict_1.default.deepEqual(first, { ok: true });
    const second = await (0, session_store_js_1.verifyOtpChallenge)(email, code, 'LOGIN');
    strict_1.default.equal(second.ok, false);
});
integration('OTP brute force is locked out after max attempts, tracked in the database', async () => {
    const email = `brute-${(0, node_crypto_1.randomUUID)()}@test.invexa.local`;
    await (0, session_store_js_1.createOtpChallenge)(email, 'LOGIN');
    let last;
    for (let i = 0; i < 6; i += 1) {
        last = await (0, session_store_js_1.verifyOtpChallenge)(email, '000000', 'LOGIN');
    }
    strict_1.default.equal(last.ok, false);
    strict_1.default.equal(last.reason, 'locked');
});
