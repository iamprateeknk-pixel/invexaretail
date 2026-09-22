"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const session_store_js_1 = require("./session-store.js");
node_test_1.default.beforeEach(() => {
    (0, session_store_js_1.resetSessionStoreForTests)();
});
(0, node_test_1.default)('generateOtpCode always returns a zero-padded 6-digit string', () => {
    for (let i = 0; i < 50; i += 1) {
        const code = (0, session_store_js_1.generateOtpCode)();
        strict_1.default.match(code, /^\d{6}$/);
    }
});
(0, node_test_1.default)('a new OTP challenge replaces the previous unused code for the same email', async () => {
    await (0, session_store_js_1.createOtpChallenge)('Admin@retail.local', 'LOGIN');
    const second = await (0, session_store_js_1.createOtpChallenge)('admin@retail.local', 'LOGIN');
    strict_1.default.deepEqual(await (0, session_store_js_1.verifyOtpChallenge)('admin@retail.local', second, 'LOGIN'), { ok: true });
    await (0, session_store_js_1.clearOtpChallenge)('admin@retail.local', 'LOGIN');
});
(0, node_test_1.default)('the same OTP code cannot be consumed twice (atomic verification)', async () => {
    const code = await (0, session_store_js_1.createOtpChallenge)('once@retail.local', 'LOGIN');
    strict_1.default.deepEqual(await (0, session_store_js_1.verifyOtpChallenge)('once@retail.local', code, 'LOGIN'), { ok: true });
    const second = await (0, session_store_js_1.verifyOtpChallenge)('once@retail.local', code, 'LOGIN');
    strict_1.default.equal(second.ok, false);
});
(0, node_test_1.default)('OTP brute force: wrong codes lock the challenge after max attempts', async () => {
    await (0, session_store_js_1.createOtpChallenge)('brute@retail.local', 'LOGIN');
    let last;
    for (let i = 0; i < 6; i += 1) {
        last = await (0, session_store_js_1.verifyOtpChallenge)('brute@retail.local', '000000', 'LOGIN');
    }
    strict_1.default.equal(last.ok, false);
    strict_1.default.equal(last.reason, 'locked');
});
(0, node_test_1.default)('refresh rotation issues a new token and retires the old one', async () => {
    const issued = await (0, session_store_js_1.createRefreshFamily)('user-1', 'company-1');
    const rotated = await (0, session_store_js_1.rotateRefreshToken)(issued.token);
    strict_1.default.equal(rotated.ok, true);
    if (rotated.ok) {
        strict_1.default.notEqual(rotated.issued.token, issued.token);
        strict_1.default.equal(rotated.userId, 'user-1');
    }
});
(0, node_test_1.default)('replaying an already-rotated refresh token is detected as reuse and revokes the family', async () => {
    const issued = await (0, session_store_js_1.createRefreshFamily)('user-2', 'company-1');
    const rotated = await (0, session_store_js_1.rotateRefreshToken)(issued.token);
    strict_1.default.equal(rotated.ok, true);
    // Replay the original (now-rotated) token - simulates a stolen-token replay.
    const replay = await (0, session_store_js_1.rotateRefreshToken)(issued.token);
    strict_1.default.deepEqual(replay, { ok: false, reason: 'reused' });
    // The whole family, including the token issued by the legitimate rotation, is dead now.
    if (rotated.ok) {
        const afterReuse = await (0, session_store_js_1.rotateRefreshToken)(rotated.issued.token);
        strict_1.default.deepEqual(afterReuse, { ok: false, reason: 'reused' });
    }
});
(0, node_test_1.default)('two concurrent rotation attempts on the same token: only one wins, the race loser is treated as reuse', async () => {
    const issued = await (0, session_store_js_1.createRefreshFamily)('user-3', 'company-1');
    const [a, b] = await Promise.all([(0, session_store_js_1.rotateRefreshToken)(issued.token), (0, session_store_js_1.rotateRefreshToken)(issued.token)]);
    const outcomes = [a.ok, b.ok].sort();
    strict_1.default.deepEqual(outcomes, [false, true]);
});
(0, node_test_1.default)('logout revokes only the presented session family, not the whole account', async () => {
    const familyA = await (0, session_store_js_1.createRefreshFamily)('user-4', 'company-1');
    const familyB = await (0, session_store_js_1.createRefreshFamily)('user-4', 'company-1');
    await (0, session_store_js_1.revokeRefreshFamily)(familyA.token);
    const rotatedA = await (0, session_store_js_1.rotateRefreshToken)(familyA.token);
    strict_1.default.equal(rotatedA.ok, false);
    const rotatedB = await (0, session_store_js_1.rotateRefreshToken)(familyB.token);
    strict_1.default.equal(rotatedB.ok, true);
});
(0, node_test_1.default)('revoke-all ends every session family for the user (sign out everywhere)', async () => {
    const familyA = await (0, session_store_js_1.createRefreshFamily)('user-5', 'company-1');
    const familyB = await (0, session_store_js_1.createRefreshFamily)('user-5', 'company-1');
    await (0, session_store_js_1.revokeAllSessionsForUser)('user-5');
    strict_1.default.equal((await (0, session_store_js_1.rotateRefreshToken)(familyA.token)).ok, false);
    strict_1.default.equal((await (0, session_store_js_1.rotateRefreshToken)(familyB.token)).ok, false);
});
