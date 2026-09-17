import type { Role } from './enterprise-repository.js';
export type AuthTokenPayload = {
    sub: string;
    email: string;
    role: Role;
    companyId?: string;
    assignedLocationIds?: string[];
};
export declare function createToken(payload: AuthTokenPayload): string;
export declare function verifyToken(token: string): AuthTokenPayload;
