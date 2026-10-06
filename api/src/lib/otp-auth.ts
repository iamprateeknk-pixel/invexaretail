// OTP and Biometric Authentication Service
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Must stay bcrypt: prisma/seed.ts writes bcrypt hashes, so any other
// algorithm here makes every seeded account fail to log in.
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  if (hash.startsWith('$2')) {
    return bcrypt.compareSync(password, hash);
  }
  // Accounts created before the bcrypt switch still carry sha256 hashes.
  const legacy = crypto.createHash('sha256').update(password).digest('hex');
  return legacy.length === hash.length && crypto.timingSafeEqual(Buffer.from(legacy), Buffer.from(hash));
}

// Hash 4-digit PIN
export function hashPin(pin: string): string {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  return crypto.createHash('sha256').update(pin).digest('hex');
}

// Verify 4-digit PIN
export function verifyPin(pin: string, hash: string): boolean {
  if (!/^\d{4}$/.test(pin)) {
    return false;
  }
  return hashPin(pin) === hash;
}

// Mock face recognition (in production, use real biometric SDK)
export function hashFaceData(faceData: string): string {
  return crypto.createHash('sha256').update(faceData).digest('hex');
}

// Mock fingerprint recognition (in production, use real biometric SDK)
export function hashFingerprintData(fingerprintData: string): string {
  return crypto.createHash('sha256').update(fingerprintData).digest('hex');
}

export type OtpDeliveryChannel = 'smtp' | 'development' | 'none';

type OtpSmtpSender = (email: string, otpCode: string) => Promise<void>;

function maskedEmail(email: string): string {
  return email.replace(/(^.).*(@.*$)/, '$1***$2');
}

function smtpHost(): string {
  return process.env.SMTP_HOST?.trim() || '';
}

export function resolveOtpDeliveryChannel(): OtpDeliveryChannel {
  if (smtpHost()) return 'smtp';
  if (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEV_OTP === 'true') {
    return 'development';
  }
  return 'none';
}

export function shouldExposeDevOtpCode(): boolean {
  return resolveOtpDeliveryChannel() === 'development';
}

async function defaultSmtpSender(email: string, otpCode: string): Promise<void> {
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

let smtpSender: OtpSmtpSender = defaultSmtpSender;

export function setOtpSmtpSender(sender: OtpSmtpSender | null): void {
  smtpSender = sender ?? defaultSmtpSender;
}

// OTP delivery must fail closed until SMTP or the local development transport
// is configured. Never print one-time codes in production logs.
export async function sendOtpEmail(email: string, otpCode: string): Promise<boolean> {
  const channel = resolveOtpDeliveryChannel();

  if (channel === 'smtp') {
    try {
      await smtpSender(email, otpCode);
      return true;
    } catch (error) {
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
import jwt from 'jsonwebtoken';

type TokenType = 'access' | 'twofactor';

function getJwtSecret(): string {
  const configuredSecret = process.env.JWT_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  return 'dev-secret-key-change-in-production';
}

// Week 3: access tokens must be short lived - a compromised access token
// self-expires quickly; session-store.ts's refresh rotation is what carries
// a signed-in session across that window.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export function generateJWT(
  userId: string,
  companyId: string,
  expiresIn: number = ACCESS_TOKEN_TTL_SECONDS,
  tokenType: TokenType = 'access',
): string {
  return jwt.sign(
    { userId, companyId, tokenType, jti: crypto.randomBytes(8).toString('hex') },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn },
  );
}

export function verifyJWT(token: string, expectedType: TokenType = 'access'): { userId: string; companyId: string } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      userId?: unknown; companyId?: unknown; tokenType?: unknown;
    };
    if (typeof payload.userId !== 'string' || typeof payload.companyId !== 'string') return null;
    // Tokens issued before this hardening update have no tokenType. They can
    // remain valid only as access tokens until their short normal expiry.
    if ((payload.tokenType ?? 'access') !== expectedType) return null;
    return { userId: payload.userId, companyId: payload.companyId };
  } catch {
    return null;
  }
}

// Phase 5: after a correct first factor, an account with two-factor on gets
// this instead of a session. tokenType 'twofactor' means verifyJWT(token,
// 'access') rejects it, so it can never be used as an access token.
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60;

export function generateTwoFactorChallenge(userId: string, companyId: string): string {
  return generateJWT(userId, companyId, TWO_FACTOR_CHALLENGE_TTL_SECONDS, 'twofactor');
}

export function verifyTwoFactorChallenge(token: string): { userId: string; companyId: string } | null {
  return verifyJWT(token, 'twofactor');
}

// Validation utilities
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password: string): { valid: boolean; message?: string } {
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

export function validateCompanyName(name: string): boolean {
  return name.length >= 2 && name.length <= 100;
}

export function validateUserName(name: string): boolean {
  return name.length >= 2 && name.length <= 100;
}

// Rate limiting for OTP attempts (in-memory, for production use Redis)
const otpAttempts = new Map<string, { attempts: number; resetTime: number }>();

export function checkOtpRateLimit(email: string): boolean {
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

export function resetOtpRateLimit(email: string): void {
  otpAttempts.delete(email);
}
