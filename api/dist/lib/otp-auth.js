"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_TOKEN_TTL_SECONDS = void 0;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.hashPin = hashPin;
exports.verifyPin = verifyPin;
exports.hashFaceData = hashFaceData;
exports.hashFingerprintData = hashFingerprintData;
exports.resolveOtpDeliveryChannel = resolveOtpDeliveryChannel;
exports.shouldExposeDevOtpCode = shouldExposeDevOtpCode;
exports.setOtpSmtpSender = setOtpSmtpSender;
exports.sendOtpEmail = sendOtpEmail;
exports.generateJWT = generateJWT;
exports.verifyJWT = verifyJWT;
exports.validateEmail = validateEmail;
exports.validatePassword = validatePassword;
exports.validateCompanyName = validateCompanyName;
exports.validateUserName = validateUserName;
exports.checkOtpRateLimit = checkOtpRateLimit;
exports.resetOtpRateLimit = resetOtpRateLimit;
// OTP and Biometric Authentication Service
const crypto = __importStar(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
// Must stay bcrypt: prisma/seed.ts writes bcrypt hashes, so any other
// algorithm here makes every seeded account fail to log in.
function hashPassword(password) {
    return bcryptjs_1.default.hashSync(password, 12);
}
function verifyPassword(password, hash) {
    if (hash.startsWith('$2')) {
        return bcryptjs_1.default.compareSync(password, hash);
    }
    // Accounts created before the bcrypt switch still carry sha256 hashes.
    const legacy = crypto.createHash('sha256').update(password).digest('hex');
    return legacy.length === hash.length && crypto.timingSafeEqual(Buffer.from(legacy), Buffer.from(hash));
}
// Hash 4-digit PIN
function hashPin(pin) {
    if (!/^\d{4}$/.test(pin)) {
        throw new Error('PIN must be exactly 4 digits');
    }
    return crypto.createHash('sha256').update(pin).digest('hex');
}
// Verify 4-digit PIN
function verifyPin(pin, hash) {
    if (!/^\d{4}$/.test(pin)) {
        return false;
    }
    return hashPin(pin) === hash;
}
// Mock face recognition (in production, use real biometric SDK)
function hashFaceData(faceData) {
    return crypto.createHash('sha256').update(faceData).digest('hex');
}
// Mock fingerprint recognition (in production, use real biometric SDK)
function hashFingerprintData(fingerprintData) {
    return crypto.createHash('sha256').update(fingerprintData).digest('hex');
}
function maskedEmail(email) {
    return email.replace(/(^.).*(@.*$)/, '$1***$2');
}
function smtpHost() {
    return process.env.SMTP_HOST?.trim() || '';
}
function resolveOtpDeliveryChannel() {
    if (smtpHost())
        return 'smtp';
    if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_OTP === 'true') {
        return 'development';
    }
    return 'none';
}
function shouldExposeDevOtpCode() {
    return resolveOtpDeliveryChannel() === 'development';
}
async function defaultSmtpSender(email, otpCode) {
    const nodemailer = await import('nodemailer');
    const createTransport = nodemailer.default?.createTransport ?? nodemailer.createTransport;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER?.trim() || '';
    const pass = process.env.SMTP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim() || '';
    const transporter = createTransport({
        host: smtpHost(),
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
    });
    await transporter.sendMail({
        from: process.env.EMAIL_FROM?.trim() || user || 'noreply@invexaretail.local',
        to: email,
        subject: 'Your Invexa Retail sign-in code',
        text: `Your one-time sign-in code is ${otpCode}. It expires in 10 minutes.`,
    });
}
let smtpSender = defaultSmtpSender;
function setOtpSmtpSender(sender) {
    smtpSender = sender ?? defaultSmtpSender;
}
// OTP delivery must fail closed until SMTP or the local development transport
// is configured. Never print one-time codes in production logs.
async function sendOtpEmail(email, otpCode) {
    const channel = resolveOtpDeliveryChannel();
    if (channel === 'smtp') {
        try {
            await smtpSender(email, otpCode);
            return true;
        }
        catch (error) {
            console.error(`SMTP OTP delivery failed for ${maskedEmail(email)}.`, error);
            return false;
        }
    }
    if (channel === 'development') {
        console.warn(`[development-only OTP] ${email}: ${otpCode}`);
        return true;
    }
    console.warn(`OTP delivery is not configured for ${maskedEmail(email)}.`);
    return false;
}
// ADR-003: access tokens only - jsonwebtoken (already a dependency),
// not a hand-rolled HMAC encoder. AGENTS.md prohibits custom crypto for
// tokens; this used to implement its own JWT sign/verify, which is exactly
// that pattern. Refresh tokens are no longer JWTs at all - see
// lib/session-store.ts for the persisted, hashed, rotating session model.
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function getJwtSecret() {
    const configuredSecret = process.env.JWT_SECRET?.trim();
    if (configuredSecret)
        return configuredSecret;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be configured in production.');
    }
    return 'dev-secret-key-change-in-production';
}
// Week 3: access tokens must be short lived - a compromised access token
// self-expires quickly; session-store.ts's refresh rotation is what carries
// a signed-in session across that window.
exports.ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
function generateJWT(userId, companyId, expiresIn = exports.ACCESS_TOKEN_TTL_SECONDS, tokenType = 'access') {
    return jsonwebtoken_1.default.sign({ userId, companyId, tokenType, jti: crypto.randomBytes(8).toString('hex') }, getJwtSecret(), { algorithm: 'HS256', expiresIn });
}
function verifyJWT(token, expectedType = 'access') {
    try {
        const payload = jsonwebtoken_1.default.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
        if (typeof payload.userId !== 'string' || typeof payload.companyId !== 'string')
            return null;
        // Tokens issued before this hardening update have no tokenType. They can
        // remain valid only as access tokens until their short normal expiry.
        if ((payload.tokenType ?? 'access') !== expectedType)
            return null;
        return { userId: payload.userId, companyId: payload.companyId };
    }
    catch {
        return null;
    }
}
// Validation utilities
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
function validatePassword(password) {
    if (password.length < 8) {
        return { valid: false, message: 'Password must be at least 8 characters' };
    }
    if (!/[A-Z]/.test(password)) {
        return { valid: false, message: 'Password must contain uppercase letters' };
    }
    if (!/[a-z]/.test(password)) {
        return { valid: false, message: 'Password must contain lowercase letters' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, message: 'Password must contain numbers' };
    }
    return { valid: true };
}
function validateCompanyName(name) {
    return name.length >= 2 && name.length <= 100;
}
function validateUserName(name) {
    return name.length >= 2 && name.length <= 100;
}
// Rate limiting for OTP attempts (in-memory, for production use Redis)
const otpAttempts = new Map();
function checkOtpRateLimit(email) {
    const now = Date.now();
    const record = otpAttempts.get(email);
    if (!record) {
        otpAttempts.set(email, { attempts: 1, resetTime: now + 60000 }); // 1 minute window
        return true;
    }
    if (now > record.resetTime) {
        otpAttempts.set(email, { attempts: 1, resetTime: now + 60000 });
        return true;
    }
    if (record.attempts >= 5) {
        return false;
    }
    record.attempts += 1;
    return true;
}
function resetOtpRateLimit(email) {
    otpAttempts.delete(email);
}
