"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOtpCode = generateOtpCode;
exports.createOtpChallenge = createOtpChallenge;
exports.clearOtpChallenge = clearOtpChallenge;
exports.verifyOtpChallenge = verifyOtpChallenge;
exports.createRefreshFamily = createRefreshFamily;
exports.rotateRefreshToken = rotateRefreshToken;
exports.revokeRefreshFamily = revokeRefreshFamily;
exports.revokeAllSessionsForUser = revokeAllSessionsForUser;
exports.resetSessionStoreForTests = resetSessionStoreForTests;
// ADR-003: persisted, hashed, rotating refresh-token sessions and OTP
// challenges. Replaces the old in-process Map/array store (wiped on
// restart, not shared across replicas, storing raw token/OTP values) with a
// database-backed model in database mode, and an equivalent in-memory
// fallback with the same rotation/reuse-detection logic in memory mode.
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_js_1 = require("./db.js");
const persistence_js_1 = require("./persistence.js");
function otpPepper() {
    return process.env.OTP_PEPPER?.trim() || process.env.JWT_SECRET?.trim() || 'dev-otp-pepper-change-in-production';
}
function hashOtp(code) {
    return node_crypto_1.default.createHmac('sha256', otpPepper()).update(code).digest('hex');
}
function hashToken(token) {
    return node_crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/** crypto.randomInt, not Math.random - Week 3: OTP generation must be CSPRNG. */
function generateOtpCode() {
    return node_crypto_1.default.randomInt(0, 1_000_000).toString().padStart(6, '0');
}
const memoryOtp = new Map();
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
function otpKey(email, purpose) {
    return `${email}::${purpose}`;
}
/** Creates a fresh OTP challenge (invalidating any prior unconsumed one for the same email+purpose) and returns the plaintext code to deliver. Never persists the plaintext. */
async function createOtpChallenge(email, purpose = 'LOGIN') {
    const normalized = email.trim().toLowerCase();
    const code = generateOtpCode();
    const codeHash = hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    if (persistence_js_1.databaseEnabled) {
        await db_js_1.prisma.otpChallenge.deleteMany({ where: { email: normalized, purpose, consumedAt: null } });
        await db_js_1.prisma.otpChallenge.create({ data: { email: normalized, purpose, codeHash, expiresAt, maxAttempts: OTP_MAX_ATTEMPTS } });
    }
    else {
        memoryOtp.set(otpKey(normalized, purpose), { codeHash, attempts: 0, maxAttempts: OTP_MAX_ATTEMPTS, expiresAt: expiresAt.getTime(), consumed: false });
    }
    return code;
}
async function clearOtpChallenge(email, purpose = 'LOGIN') {
    const normalized = email.trim().toLowerCase();
    if (persistence_js_1.databaseEnabled) {
        await db_js_1.prisma.otpChallenge.deleteMany({ where: { email: normalized, purpose, consumedAt: null } });
        return;
    }
    memoryOtp.delete(otpKey(normalized, purpose));
}
/** Atomic: a code can consume its challenge exactly once, even under concurrent requests. */
async function verifyOtpChallenge(email, code, purpose = 'LOGIN') {
    const normalized = email.trim().toLowerCase();
    const codeHash = hashOtp(code);
    if (persistence_js_1.databaseEnabled) {
        return db_js_1.prisma.$transaction(async (tx) => {
            const challenge = await tx.otpChallenge.findFirst({
                where: { email: normalized, purpose, consumedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            if (!challenge)
                return { ok: false, reason: 'not_found' };
            if (challenge.expiresAt.getTime() < Date.now())
                return { ok: false, reason: 'expired' };
            if (challenge.attempts >= challenge.maxAttempts)
                return { ok: false, reason: 'locked' };
            if (challenge.codeHash !== codeHash) {
                await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
                return { ok: false, reason: 'mismatch' };
            }
            const claimed = await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
            if (claimed.count !== 1)
                return { ok: false, reason: 'not_found' };
            return { ok: true };
        });
    }
    const entry = memoryOtp.get(otpKey(normalized, purpose));
    if (!entry || entry.consumed)
        return { ok: false, reason: 'not_found' };
    if (Date.now() > entry.expiresAt)
        return { ok: false, reason: 'expired' };
    if (entry.attempts >= entry.maxAttempts)
        return { ok: false, reason: 'locked' };
    if (entry.codeHash !== codeHash) {
        entry.attempts += 1;
        return { ok: false, reason: 'mismatch' };
    }
    entry.consumed = true;
    return { ok: true };
}
// ---------------------------------------------------------------------------
// Refresh-token session families
// ---------------------------------------------------------------------------
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const memorySessions = new Map(); // keyed by tokenHash
function randomOpaqueToken() {
    return node_crypto_1.default.randomBytes(32).toString('base64url');
}
async function issueRefreshToken(args) {
    const token = randomOpaqueToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    if (persistence_js_1.databaseEnabled) {
        await db_js_1.prisma.userSession.create({
            data: {
                userId: args.userId,
                familyId: args.familyId,
                tokenHash,
                status: 'ACTIVE',
                rotationCounter: args.rotationCounter,
                expiresAt,
                deviceInfo: args.meta.deviceInfo ?? null,
                ipAddress: args.meta.ipAddress ?? null,
                userAgent: args.meta.userAgent ?? null,
            },
        });
    }
    else {
        memorySessions.set(tokenHash, {
            userId: args.userId,
            companyId: args.companyId,
            familyId: args.familyId,
            status: 'ACTIVE',
            expiresAt: expiresAt.getTime(),
            rotationCounter: args.rotationCounter,
        });
    }
    return { token, familyId: args.familyId, expiresAt };
}
/** Starts a brand new session family (e.g. on login). */
async function createRefreshFamily(userId, companyId, meta = {}) {
    const familyId = node_crypto_1.default.randomUUID();
    return issueRefreshToken({ userId, companyId, familyId, rotationCounter: 0, meta });
}
async function revokeFamilyById(familyId) {
    if (persistence_js_1.databaseEnabled) {
        await db_js_1.prisma.userSession.updateMany({ where: { familyId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
        return;
    }
    for (const session of memorySessions.values()) {
        if (session.familyId === familyId)
            session.status = 'REVOKED';
    }
}
/**
 * Rotates a refresh token: the presented token must be the current ACTIVE
 * member of its family. Presenting a token that has already been rotated or
 * revoked is treated as token theft/replay - the whole family is revoked so
 * every device sharing it is forced to re-authenticate.
 */
async function rotateRefreshToken(presentedToken, meta = {}) {
    const tokenHash = hashToken(presentedToken);
    if (persistence_js_1.databaseEnabled) {
        return db_js_1.prisma.$transaction(async (tx) => {
            const row = await tx.userSession.findUnique({ where: { tokenHash } });
            if (!row)
                return { ok: false, reason: 'invalid' };
            if (row.status !== 'ACTIVE') {
                await tx.userSession.updateMany({ where: { familyId: row.familyId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
                return { ok: false, reason: 'reused' };
            }
            if (row.expiresAt.getTime() < Date.now())
                return { ok: false, reason: 'expired' };
            // Atomic claim: only one concurrent rotation attempt can win ACTIVE -> ROTATED.
            const claim = await tx.userSession.updateMany({ where: { id: row.id, status: 'ACTIVE' }, data: { status: 'ROTATED' } });
            if (claim.count !== 1) {
                await tx.userSession.updateMany({ where: { familyId: row.familyId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
                return { ok: false, reason: 'reused' };
            }
            const user = await tx.user.findUnique({ where: { id: row.userId }, select: { companyId: true } });
            const issued = await issueRefreshToken({ userId: row.userId, companyId: user?.companyId ?? '', familyId: row.familyId, rotationCounter: row.rotationCounter + 1, meta });
            await tx.userSession.update({ where: { id: row.id }, data: { replacedByTokenHash: hashToken(issued.token) } });
            return { ok: true, userId: row.userId, companyId: user?.companyId ?? '', issued };
        });
    }
    const row = memorySessions.get(tokenHash);
    if (!row)
        return { ok: false, reason: 'invalid' };
    if (row.status !== 'ACTIVE') {
        await revokeFamilyById(row.familyId);
        return { ok: false, reason: 'reused' };
    }
    if (Date.now() > row.expiresAt)
        return { ok: false, reason: 'expired' };
    row.status = 'ROTATED';
    const issued = await issueRefreshToken({ userId: row.userId, companyId: row.companyId, familyId: row.familyId, rotationCounter: row.rotationCounter + 1, meta });
    return { ok: true, userId: row.userId, companyId: row.companyId, issued };
}
/** Logout: revokes just the presented token's family (this device/session). */
async function revokeRefreshFamily(presentedToken) {
    const tokenHash = hashToken(presentedToken);
    if (persistence_js_1.databaseEnabled) {
        const row = await db_js_1.prisma.userSession.findUnique({ where: { tokenHash } });
        if (!row)
            return;
        await revokeFamilyById(row.familyId);
        return;
    }
    const row = memorySessions.get(tokenHash);
    if (!row)
        return;
    await revokeFamilyById(row.familyId);
}
/** "Sign out everywhere": revokes every session family for this user. */
async function revokeAllSessionsForUser(userId) {
    if (persistence_js_1.databaseEnabled) {
        await db_js_1.prisma.userSession.updateMany({ where: { userId, status: { not: 'REVOKED' } }, data: { status: 'REVOKED', revokedAt: new Date() } });
        return;
    }
    for (const session of memorySessions.values()) {
        if (session.userId === userId)
            session.status = 'REVOKED';
    }
}
function resetSessionStoreForTests() {
    memorySessions.clear();
    memoryOtp.clear();
}
