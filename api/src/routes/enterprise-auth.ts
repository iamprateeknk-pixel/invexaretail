// Enterprise authentication routes with OTP, biometrics, and multi-org support
import { type Request, type Response, type NextFunction, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  hashPassword,
  verifyPassword,
  hashPin,
  verifyPin,
  sendOtpEmail,
  resolveOtpDeliveryChannel,
  shouldExposeDevOtpCode,
  generateJWT,
  verifyJWT,
  ACCESS_TOKEN_TTL_SECONDS,
  validateEmail,
  validatePassword,
  validateUserName,
  checkOtpRateLimit,
  resetOtpRateLimit,
} from '../lib/otp-auth.js';
import {
  createOtpChallenge,
  verifyOtpChallenge,
  clearOtpChallenge,
  createRefreshFamily,
  rotateRefreshToken,
  revokeRefreshFamily,
  revokeAllSessionsForUser,
  type SessionMeta,
} from '../lib/session-store.js';
import { isAllowedOrigin } from '../lib/cors-origins.js';
import * as repo from '../lib/enterprise-repository.js';
import { rejectSuspendedCompany } from '../lib/saas/company-access.js';
import { ControlPlaneError, apiKeyAllowsMethod, controlPlane } from '../lib/saas/control-plane.js';

const router = Router();

// Rate limiting for auth endpoints
const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 3,
  message: 'Too many OTP requests, please try again later',
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 50,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

// Type for authenticated request
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      companyId?: string;
      user?: repo.EnhancedUserRecord;
      rawBody?: string;
      apiKey?: { id: string; companyId: string; name: string; prefix: string; scopes: string[] };
    }
  }
}

function attachApiKey(req: Request, key: { id: string; companyId: string; name: string; prefix: string; scopes: string[] }): void {
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
export function extractToken(req: Request, res: Response, next: NextFunction): void {
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
      const key = controlPlane.verifyApiKey(token);
      if (!key) {
        res.status(401).json({ error: 'Invalid API key', code: 'API_KEY_INVALID' });
        return;
      }
      if (!apiKeyAllowsMethod(key.scopes, req.method)) {
        res.status(403).json({ error: 'API key scope does not allow this method', code: 'API_KEY_SCOPE' });
        return;
      }
      attachApiKey(req, key);
    } catch (error) {
      if (error instanceof ControlPlaneError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
    next();
    return;
  }

  const decoded = verifyJWT(token, 'access');

  if (decoded) {
    req.userId = decoded.userId;
    req.companyId = decoded.companyId;
  }

  next();
}

// Middleware to require authentication
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.apiKey && req.user && req.companyId) {
    if (rejectSuspendedCompany(req.companyId, res)) return;
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
  if (rejectSuspendedCompany(user.companyId, res)) return;
  req.user = user;
  next();
}

function publicUser(user: repo.EnhancedUserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    branchIds: user.branchIds,
  };
}

// ADR-003: the refresh token lives in a Secure HttpOnly SameSite cookie for
// browser clients. `SameSite=None` is required for the API and web app to be
// on different origins (per ALLOWED_ORIGINS/render.yaml), which in turn
// requires Secure - so this cookie is never usable over plain HTTP.
const REFRESH_COOKIE_NAME = 'invexa_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function refreshCookieOptions() {
  const production = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: (production ? 'none' : 'lax') as 'none' | 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

/** Minimal cookie-header parser: avoids adding a cookie-parser dependency for one read path. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Temporary compatibility path (Week 3 requirement): keep returning the
 * refresh token in the JSON body - mobile clients have no cookie jar and
 * must receive it this way to store it in platform secure storage (Week 16)
 * - in addition to setting the cookie. Set LEGACY_REFRESH_TOKEN_IN_BODY_UNTIL
 * to an ISO date to stop returning it to *browser* callers (any request
 * carrying an Origin header) after that date; requests with no Origin header
 * (native apps) always get it in the body regardless.
 */
function legacyBodyTokenExpired(): boolean {
  const until = process.env.LEGACY_REFRESH_TOKEN_IN_BODY_UNTIL?.trim();
  if (!until) return false;
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) && Date.now() > parsed;
}

function sessionMetaFor(req: Request): SessionMeta {
  return {
    deviceInfo: typeof req.body?.deviceInfo === 'string' ? req.body.deviceInfo.slice(0, 191) : undefined,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 500),
  };
}

async function issueSessionTokens(req: Request, res: Response, user: repo.EnhancedUserRecord): Promise<{ token: string; refreshToken?: string }> {
  const accessToken = generateJWT(user.id, user.companyId, ACCESS_TOKEN_TTL_SECONDS);
  const issued = await createRefreshFamily(user.id, user.companyId, sessionMetaFor(req));
  setRefreshCookie(res, issued.token);
  const isBrowserOrigin = Boolean(req.headers.origin);
  const includeInBody = !isBrowserOrigin || !legacyBodyTokenExpired();
  return { token: accessToken, ...(includeInBody ? { refreshToken: issued.token } : {}) };
}

/** Defense in depth against CSRF beyond SameSite: a same-site request either has no Origin header (native apps, same-origin form posts in old browsers) or one that matches our allowlist. */
function rejectCrossSiteOrigin(req: Request, res: Response): boolean {
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'Cross-site request rejected', code: 'CSRF_ORIGIN_MISMATCH' });
    return true;
  }
  return false;
}

// ============================================
// COMPANY & AUTH SETUP
// ============================================

// ============================================
// EMAIL + OTP LOGIN
// ============================================

// Step 1: Request OTP
router.post('/send-otp', otpLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!validateEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check rate limit
    if (!checkOtpRateLimit(normalizedEmail)) {
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

    if (rejectSuspendedCompany(user.companyId, res)) return;

    // Generate and save OTP - crypto.randomInt (not Math.random), hashed at rest.
    const otpCode = await createOtpChallenge(normalizedEmail, 'LOGIN');

    // Send OTP via email. Delete the short-lived challenge when no provider is
    // configured so an undelivered code can never be accepted.
    const delivered = await sendOtpEmail(normalizedEmail, otpCode);
    if (!delivered) {
      await clearOtpChallenge(normalizedEmail, 'LOGIN');
      return res.status(503).json({ error: 'Email OTP is not configured. Use password login.' });
    }

    const delivery = resolveOtpDeliveryChannel();
    res.json({
      success: true,
      message: 'OTP sent to your email',
      delivery,
      expiresIn: 600, // 10 minutes
      ...(shouldExposeDevOtpCode() ? { otpCode } : {}),
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Step 2: Verify OTP and login
router.post('/verify-otp', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, otpCode } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedOtp = typeof otpCode === 'string' ? otpCode.trim() : '';

    if (!validateEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (!normalizedOtp || normalizedOtp.length !== 6) {
      return res.status(400).json({ error: 'Invalid OTP format' });
    }

    // Verify OTP - single atomic consume, so a code cannot succeed twice.
    const result = await verifyOtpChallenge(normalizedEmail, normalizedOtp, 'LOGIN');
    if (result.ok === false) {
      return res.status(401).json({ error: 'Invalid or expired OTP', code: `OTP_${result.reason.toUpperCase()}` });
    }

    // Find user
    const user = repo.findUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (rejectSuspendedCompany(user.companyId, res)) return;

    // Update last login
    repo.updateUserLastLogin(user.id);
    resetOtpRateLimit(normalizedEmail);

    const tokens = await issueSessionTokens(req, res, user);

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
      ...tokens,
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// ============================================
// PASSWORD-BASED LOGIN (BACKUP)
// ============================================

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!validateEmail(normalizedEmail)) {
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
        } catch {
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

    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (rejectSuspendedCompany(user.companyId, res)) return;

    // Update last login
    repo.updateUserLastLogin(user.id);

    const tokens = await issueSessionTokens(req, res, user);

    res.json({
      success: true,
      user: publicUser(user),
      ...tokens,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// REFRESH TOKEN
// ============================================

router.post('/refresh-token', async (req: Request, res: Response) => {
  try {
    if (rejectCrossSiteOrigin(req, res)) return;

    const presented = readCookie(req, REFRESH_COOKIE_NAME) || (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '');
    if (!presented) {
      return res.status(400).json({ error: 'Refresh token required', code: 'REFRESH_TOKEN_MISSING' });
    }

    const rotated = await rotateRefreshToken(presented, sessionMetaFor(req));
    if (rotated.ok === false) {
      clearRefreshCookie(res);
      if (rotated.reason === 'reused') {
        // Replay of an already-rotated/revoked token: the whole family was
        // just revoked server-side. Every device on it must sign in again.
        return res.status(401).json({ error: 'Session invalidated; please sign in again.', code: 'REFRESH_TOKEN_REUSED' });
      }
      return res.status(401).json({ error: 'Invalid refresh token', code: `REFRESH_TOKEN_${rotated.reason.toUpperCase()}` });
    }

    const user = repo.findUserById(rotated.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive', code: 'USER_INACTIVE' });
    }
    if (rejectSuspendedCompany(user.companyId, res)) return;

    setRefreshCookie(res, rotated.issued.token);
    const isBrowserOrigin = Boolean(req.headers.origin);
    const includeInBody = !isBrowserOrigin || !legacyBodyTokenExpired();

    res.json({
      success: true,
      token: generateJWT(user.id, user.companyId, ACCESS_TOKEN_TTL_SECONDS),
      ...(includeInBody ? { refreshToken: rotated.issued.token } : {}),
      user: publicUser(user),
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

router.post('/logout', async (req: Request, res: Response) => {
  const presented = readCookie(req, REFRESH_COOKIE_NAME) || (typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '');
  if (presented) {
    await revokeRefreshFamily(presented);
  }
  clearRefreshCookie(res);
  res.json({ success: true });
});

// "Sign out everywhere": revokes every refresh-token family for this user,
// not just the caller's own session.
router.post('/logout-all', extractToken, requireAuth, async (req: Request, res: Response) => {
  await revokeAllSessionsForUser(req.user!.id);
  clearRefreshCookie(res);
  res.json({ success: true });
});

// ============================================
// BIOMETRIC SETUP (MOBILE)
// ============================================

router.post('/setup-biometric', extractToken, requireAuth, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LEGACY_BIOMETRIC !== 'true') {
    return res.status(501).json({ error: 'Server-side mock biometrics are disabled. Use the device biometric unlock flow.' });
  }
  try {
    const { method, pin, faceData, fingerprintData } = req.body;
    const userId = req.userId!;

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
      credential.pin4Digit = hashPin(pin);
      if (!credential.enabledMethods.includes('pin')) {
        credential.enabledMethods.push('pin');
      }
    } else if (method === 'face' && faceData) {
      credential.faceDataHash = require('../lib/otp-auth').hashFaceData(faceData);
      if (!credential.enabledMethods.includes('face')) {
        credential.enabledMethods.push('face');
      }
    } else if (method === 'fingerprint' && fingerprintData) {
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
  } catch (error) {
    console.error('Setup biometric error:', error);
    res.status(500).json({ error: 'Biometric setup failed' });
  }
});

// Verify biometric (mobile login)
router.post('/verify-biometric', loginLimiter, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_LEGACY_BIOMETRIC !== 'true') {
    return res.status(501).json({ error: 'Server-side mock biometrics are disabled. Use password login.' });
  }
  try {
    const { email, method, pin, faceData, fingerprintData } = req.body;

    if (!validateEmail(email)) {
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
      if (!credential.pin4Digit || !verifyPin(pin, credential.pin4Digit)) {
        return res.status(401).json({ error: 'Invalid PIN' });
      }
    } else if (method === 'face' && faceData) {
      if (!credential.faceDataHash) {
        return res.status(400).json({ error: 'Face recognition not configured' });
      }
      // In production, use ML-based face recognition
      // For now, simple hash comparison
      const { hashFaceData } = await import('../lib/otp-auth.js');
      if (hashFaceData(faceData) !== credential.faceDataHash) {
        return res.status(401).json({ error: 'Face recognition failed' });
      }
    } else if (method === 'fingerprint' && fingerprintData) {
      if (!credential.fingerprintHash) {
        return res.status(400).json({ error: 'Fingerprint not configured' });
      }
      const { hashFingerprintData } = await import('../lib/otp-auth.js');
      if (hashFingerprintData(fingerprintData) !== credential.fingerprintHash) {
        return res.status(401).json({ error: 'Fingerprint verification failed' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid biometric method' });
    }

    // Update last login and credential
    repo.updateUserLastLogin(user.id);
    credential.lastUsed = new Date().toISOString();

    const tokens = await issueSessionTokens(req, res, user);

    res.json({
      success: true,
      user: publicUser(user),
      ...tokens,
    });
  } catch (error) {
    console.error('Verify biometric error:', error);
    res.status(500).json({ error: 'Biometric verification failed' });
  }
});

export default router;
