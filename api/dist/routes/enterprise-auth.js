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
exports.extractToken = extractToken;
exports.requireAuth = requireAuth;
// Enterprise authentication routes with OTP, biometrics, and multi-org support
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const otp_auth_js_1 = require("../lib/otp-auth.js");
const repo = __importStar(require("../lib/enterprise-repository.js"));
const company_access_js_1 = require("../lib/saas/company-access.js");
const control_plane_js_1 = require("../lib/saas/control-plane.js");
const router = (0, express_1.Router)();
// Rate limiting for auth endpoints
const otpLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60_000,
    limit: 3,
    message: 'Too many OTP requests, please try again later',
});
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60_000,
    limit: 50,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});
function attachApiKey(req, key) {
    const now = new Date().toISOString();
    req.apiKey = key;
    req.companyId = key.companyId;
    req.userId = `apikey:${key.id}`;
    req.user = {
        id: `apikey:${key.id}`,
        companyId: key.companyId,
        email: `${key.prefix}@api.invexa.local`,
        name: key.name,
        role: 'ADMIN',
        branchIds: [],
        locationIds: [],
        status: 'active',
        createdAt: now,
        updatedAt: now,
    };
}
// Middleware to extract JWT token
function extractToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return next();
    }
    const token = authHeader.slice(7);
    if (token.startsWith('invx_')) {
        if (req.method === 'OPTIONS') {
            next();
            return;
        }
        try {
            const key = control_plane_js_1.controlPlane.verifyApiKey(token);
            if (!key) {
                res.status(401).json({ error: 'Invalid API key', code: 'API_KEY_INVALID' });
                return;
            }
            if (!(0, control_plane_js_1.apiKeyAllowsMethod)(key.scopes, req.method)) {
                res.status(403).json({ error: 'API key scope does not allow this method', code: 'API_KEY_SCOPE' });
                return;
            }
            attachApiKey(req, key);
        }
        catch (error) {
            if (error instanceof control_plane_js_1.ControlPlaneError) {
                res.status(error.status).json({ error: error.message, code: error.code });
                return;
            }
            throw error;
        }
        next();
        return;
    }
    const decoded = (0, otp_auth_js_1.verifyJWT)(token, 'access');
    if (decoded) {
        req.userId = decoded.userId;
        req.companyId = decoded.companyId;
    }
    next();
}
// Middleware to require authentication
function requireAuth(req, res, next) {
    if (req.apiKey && req.user && req.companyId) {
        if ((0, company_access_js_1.rejectSuspendedCompany)(req.companyId, res))
            return;
        next();
        return;
    }
    if (!req.userId || !req.companyId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const user = repo.findUserById(req.userId);
    if (!user || user.status !== 'active') {
        res.status(401).json({ error: 'User not found or inactive' });
        return;
    }
    if ((0, company_access_js_1.rejectSuspendedCompany)(user.companyId, res))
        return;
    req.user = user;
    next();
}
function publicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        branchIds: user.branchIds,
    };
}
function issueSessionTokens(user) {
    const token = (0, otp_auth_js_1.generateJWT)(user.id, user.companyId, otp_auth_js_1.ACCESS_TOKEN_TTL_SECONDS);
    const refreshToken = (0, otp_auth_js_1.generateRefreshToken)(user.id, user.companyId);
    repo.storeRefreshToken(refreshToken, user.id, user.companyId, otp_auth_js_1.REFRESH_TOKEN_TTL_SECONDS * 1000);
    return { token, refreshToken };
}
// ============================================
// COMPANY & AUTH SETUP
// ============================================
// ============================================
// EMAIL + OTP LOGIN
// ============================================
// Step 1: Request OTP
router.post('/send-otp', otpLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!(0, otp_auth_js_1.validateEmail)(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        // Check rate limit
        if (!(0, otp_auth_js_1.checkOtpRateLimit)(normalizedEmail)) {
            return res.status(429).json({ error: 'Too many OTP requests for this email' });
        }
        // Find user
        const user = repo.findUserByEmail(normalizedEmail);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'User account is inactive' });
        }
        if ((0, company_access_js_1.rejectSuspendedCompany)(user.companyId, res))
            return;
        // Generate and save OTP
        const otpCode = (0, otp_auth_js_1.generateOTP)();
        repo.createOtpSession(normalizedEmail, otpCode);
        // Send OTP via email. Delete the short-lived session when no provider is
        // configured so an undelivered code can never be accepted.
        const delivered = await (0, otp_auth_js_1.sendOtpEmail)(normalizedEmail, otpCode);
        if (!delivered) {
            repo.clearOtpSession(normalizedEmail);
            return res.status(503).json({ error: 'Email OTP is not configured. Use password login.' });
        }
        const delivery = (0, otp_auth_js_1.resolveOtpDeliveryChannel)();
        res.json({
            success: true,
            message: 'OTP sent to your email',
            delivery,
            expiresIn: 600, // 10 minutes
            ...((0, otp_auth_js_1.shouldExposeDevOtpCode)() ? { otpCode } : {}),
        });
    }
    catch (error) {
        console.error('Send OTP error:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});
// Step 2: Verify OTP and login
router.post('/verify-otp', loginLimiter, async (req, res) => {
    try {
        const { email, otpCode } = req.body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const normalizedOtp = typeof otpCode === 'string' ? otpCode.trim() : '';
        if (!(0, otp_auth_js_1.validateEmail)(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (!normalizedOtp || normalizedOtp.length !== 6) {
            return res.status(400).json({ error: 'Invalid OTP format' });
        }
        // Verify OTP
        const isValid = repo.verifyOtpSession(normalizedEmail, normalizedOtp);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid or expired OTP' });
        }
        // Find user
        const user = repo.findUserByEmail(normalizedEmail);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if ((0, company_access_js_1.rejectSuspendedCompany)(user.companyId, res))
            return;
        // Update last login
        repo.updateUserLastLogin(user.id);
        // Clear OTP session
        repo.clearOtpSession(normalizedEmail);
        (0, otp_auth_js_1.resetOtpRateLimit)(normalizedEmail);
        const { token, refreshToken } = issueSessionTokens(user);
        // Log audit
        repo.logAuditAction({
            companyId: user.companyId,
            userId: user.id,
            userName: user.name,
            action: 'OTP_LOGIN',
            entityType: 'USER',
            entityId: user.id,
        });
        res.json({
            success: true,
            user: publicUser(user),
            token,
            refreshToken,
        });
    }
    catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ error: 'OTP verification failed' });
    }
});
// ============================================
// PASSWORD-BASED LOGIN (BACKUP)
// ============================================
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!(0, otp_auth_js_1.validateEmail)(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        if (!password) {
            return res.status(400).json({ error: 'Password required' });
        }
        let user = repo.findUserByEmail(normalizedEmail);
        if (!user || !user.passwordHash) {
            const { databaseEnabled, hydrateAuthUsers } = await import('../lib/persistence.js');
            if (databaseEnabled && repo.enhancedUsers.length === 0) {
                try {
                    await hydrateAuthUsers();
                }
                catch {
                    return res.status(503).json({
                        error: 'The inventory database is reconnecting. Wait 30 seconds and sign in again.',
                        code: 'DATABASE_RECONNECTING',
                    });
                }
                user = repo.findUserByEmail(normalizedEmail);
            }
        }
        if (!user || !user.passwordHash) {
            if (repo.enhancedUsers.length === 0) {
                return res.status(503).json({
                    error: 'The inventory database is reconnecting. Wait 30 seconds and sign in again.',
                    code: 'DATABASE_RECONNECTING',
                });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'User account is inactive' });
        }
        if (!(0, otp_auth_js_1.verifyPassword)(password, user.passwordHash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if ((0, company_access_js_1.rejectSuspendedCompany)(user.companyId, res))
            return;
        // Update last login
        repo.updateUserLastLogin(user.id);
        const { token, refreshToken } = issueSessionTokens(user);
        res.json({
            success: true,
            user: publicUser(user),
            token,
            refreshToken,
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});
// ============================================
// REFRESH TOKEN
// ============================================
router.post('/refresh-token', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }
        if (repo.isRefreshTokenRevoked(refreshToken)) {
            return res.status(401).json({ error: 'Refresh token revoked' });
        }
        const decoded = (0, otp_auth_js_1.verifyJWT)(refreshToken, 'refresh');
        if (!decoded) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        const user = repo.findUserById(decoded.userId);
        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'User not found or inactive' });
        }
        if ((0, company_access_js_1.rejectSuspendedCompany)(user.companyId, res))
            return;
        repo.revokeRefreshToken(refreshToken);
        const tokens = issueSessionTokens(user);
        res.json({
            success: true,
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            user: publicUser(user),
        });
    }
    catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});
router.post('/logout', async (req, res) => {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
    if (refreshToken) {
        repo.revokeRefreshToken(refreshToken);
    }
    res.json({ success: true });
});
// ============================================
// BIOMETRIC SETUP (MOBILE)
// ============================================
router.post('/setup-biometric', extractToken, requireAuth, async (req, res) => {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LEGACY_BIOMETRIC !== 'true') {
        return res.status(501).json({ error: 'Server-side mock biometrics are disabled. Use the device biometric unlock flow.' });
    }
    try {
        const { method, pin, faceData, fingerprintData } = req.body;
        const userId = req.userId;
        if (!['pin', 'face', 'fingerprint'].includes(method)) {
            return res.status(400).json({ error: 'Invalid biometric method' });
        }
        // Find or create biometric credential
        let credential = repo.findBiometricByUserId(userId);
        if (!credential) {
            credential = repo.createBiometricCredential({
                userId,
                enabledMethods: [],
            });
        }
        // Add method
        if (method === 'pin' && pin) {
            credential.pin4Digit = (0, otp_auth_js_1.hashPin)(pin);
            if (!credential.enabledMethods.includes('pin')) {
                credential.enabledMethods.push('pin');
            }
        }
        else if (method === 'face' && faceData) {
            credential.faceDataHash = require('../lib/otp-auth').hashFaceData(faceData);
            if (!credential.enabledMethods.includes('face')) {
                credential.enabledMethods.push('face');
            }
        }
        else if (method === 'fingerprint' && fingerprintData) {
            credential.fingerprintHash = require('../lib/otp-auth').hashFingerprintData(fingerprintData);
            if (!credential.enabledMethods.includes('fingerprint')) {
                credential.enabledMethods.push('fingerprint');
            }
        }
        credential.updatedAt = new Date().toISOString();
        res.json({
            success: true,
            message: `Biometric method (${method}) enabled`,
            enabledMethods: credential.enabledMethods,
        });
    }
    catch (error) {
        console.error('Setup biometric error:', error);
        res.status(500).json({ error: 'Biometric setup failed' });
    }
});
// Verify biometric (mobile login)
router.post('/verify-biometric', loginLimiter, async (req, res) => {
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LEGACY_BIOMETRIC !== 'true') {
        return res.status(501).json({ error: 'Server-side mock biometrics are disabled. Use password login.' });
    }
    try {
        const { email, method, pin, faceData, fingerprintData } = req.body;
        if (!(0, otp_auth_js_1.validateEmail)(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        const user = repo.findUserByEmail(email);
        if (!user || user.status !== 'active') {
            return res.status(401).json({ error: 'User not found or inactive' });
        }
        const credential = repo.findBiometricByUserId(user.id);
        if (!credential) {
            return res.status(400).json({ error: 'Biometric not configured' });
        }
        // Verify based on method
        if (method === 'pin' && pin) {
            if (!credential.pin4Digit || !(0, otp_auth_js_1.verifyPin)(pin, credential.pin4Digit)) {
                return res.status(401).json({ error: 'Invalid PIN' });
            }
        }
        else if (method === 'face' && faceData) {
            if (!credential.faceDataHash) {
                return res.status(400).json({ error: 'Face recognition not configured' });
            }
            // In production, use ML-based face recognition
            // For now, simple hash comparison
            const { hashFaceData } = await import('../lib/otp-auth.js');
            if (hashFaceData(faceData) !== credential.faceDataHash) {
                return res.status(401).json({ error: 'Face recognition failed' });
            }
        }
        else if (method === 'fingerprint' && fingerprintData) {
            if (!credential.fingerprintHash) {
                return res.status(400).json({ error: 'Fingerprint not configured' });
            }
            const { hashFingerprintData } = await import('../lib/otp-auth.js');
            if (hashFingerprintData(fingerprintData) !== credential.fingerprintHash) {
                return res.status(401).json({ error: 'Fingerprint verification failed' });
            }
        }
        else {
            return res.status(400).json({ error: 'Invalid biometric method' });
        }
        // Update last login and credential
        repo.updateUserLastLogin(user.id);
        credential.lastUsed = new Date().toISOString();
        const { token, refreshToken } = issueSessionTokens(user);
        res.json({
            success: true,
            user: publicUser(user),
            token,
            refreshToken,
        });
    }
    catch (error) {
        console.error('Verify biometric error:', error);
        res.status(500).json({ error: 'Biometric verification failed' });
    }
});
exports.default = router;
