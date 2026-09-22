export declare function hashPassword(password: string): string;
export declare function verifyPassword(password: string, hash: string): boolean;
export declare function hashPin(pin: string): string;
export declare function verifyPin(pin: string, hash: string): boolean;
export declare function hashFaceData(faceData: string): string;
export declare function hashFingerprintData(fingerprintData: string): string;
export type OtpDeliveryChannel = 'smtp' | 'development' | 'none';
type OtpSmtpSender = (email: string, otpCode: string) => Promise<void>;
export declare function resolveOtpDeliveryChannel(): OtpDeliveryChannel;
export declare function shouldExposeDevOtpCode(): boolean;
export declare function setOtpSmtpSender(sender: OtpSmtpSender | null): void;
export declare function sendOtpEmail(email: string, otpCode: string): Promise<boolean>;
type TokenType = 'access';
export declare const ACCESS_TOKEN_TTL_SECONDS: number;
export declare function generateJWT(userId: string, companyId: string, expiresIn?: number, tokenType?: TokenType): string;
export declare function verifyJWT(token: string, expectedType?: TokenType): {
    userId: string;
    companyId: string;
} | null;
export declare function validateEmail(email: string): boolean;
export declare function validatePassword(password: string): {
    valid: boolean;
    message?: string;
};
export declare function validateCompanyName(name: string): boolean;
export declare function validateUserName(name: string): boolean;
export declare function checkOtpRateLimit(email: string): boolean;
export declare function resetOtpRateLimit(email: string): void;
export {};
