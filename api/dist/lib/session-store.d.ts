/** crypto.randomInt, not Math.random - Week 3: OTP generation must be CSPRNG. */
export declare function generateOtpCode(): string;
export type OtpPurpose = 'LOGIN';
export type OtpVerifyResult = {
    ok: true;
} | {
    ok: false;
    reason: 'not_found' | 'expired' | 'locked' | 'mismatch';
};
/** Creates a fresh OTP challenge (invalidating any prior unconsumed one for the same email+purpose) and returns the plaintext code to deliver. Never persists the plaintext. */
export declare function createOtpChallenge(email: string, purpose?: OtpPurpose): Promise<string>;
export declare function clearOtpChallenge(email: string, purpose?: OtpPurpose): Promise<void>;
/** Atomic: a code can consume its challenge exactly once, even under concurrent requests. */
export declare function verifyOtpChallenge(email: string, code: string, purpose?: OtpPurpose): Promise<OtpVerifyResult>;
export type SessionMeta = {
    deviceInfo?: string;
    ipAddress?: string;
    userAgent?: string;
};
export type IssuedRefreshToken = {
    token: string;
    familyId: string;
    expiresAt: Date;
};
export type RotateResult = {
    ok: true;
    userId: string;
    companyId: string;
    issued: IssuedRefreshToken;
} | {
    ok: false;
    reason: 'invalid' | 'expired' | 'reused';
};
/** Starts a brand new session family (e.g. on login). */
export declare function createRefreshFamily(userId: string, companyId: string, meta?: SessionMeta): Promise<IssuedRefreshToken>;
/**
 * Rotates a refresh token: the presented token must be the current ACTIVE
 * member of its family. Presenting a token that has already been rotated or
 * revoked is treated as token theft/replay - the whole family is revoked so
 * every device sharing it is forced to re-authenticate.
 */
export declare function rotateRefreshToken(presentedToken: string, meta?: SessionMeta): Promise<RotateResult>;
/** Logout: revokes just the presented token's family (this device/session). */
export declare function revokeRefreshFamily(presentedToken: string): Promise<void>;
/** "Sign out everywhere": revokes every session family for this user. */
export declare function revokeAllSessionsForUser(userId: string): Promise<void>;
export declare function resetSessionStoreForTests(): void;
