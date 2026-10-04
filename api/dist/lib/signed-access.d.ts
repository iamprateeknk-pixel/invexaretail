export type SignedAccessClaims = {
    kind: string;
    resource: string;
    companyId: string;
    exp: number;
};
export declare function createSignedAccessToken(input: {
    kind: string;
    resource: string;
    companyId: string;
    ttlSeconds?: number;
}, now?: number): {
    token: string;
    expiresAt: string;
};
/** Returns the claims only if the signature is genuine and the link has not expired; otherwise null. */
export declare function verifySignedAccessToken(token: string, now?: number): SignedAccessClaims | null;
