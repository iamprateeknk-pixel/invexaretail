export declare const REQUIRED_WEB_ORIGINS: string[];
export declare function normalizeOrigin(value: string): string | null;
/**
 * Hostinger env can override ALLOWED_ORIGINS and accidentally drop the live
 * website. Always keep normalized production origins, then add extras.
 */
export declare function resolveAllowedOrigins(envValue?: string | null): string[];
export declare function isAllowedOrigin(origin: string | undefined, allowedOrigins?: string[]): boolean;
