import jwt from 'jsonwebtoken';
import type { Role } from './enterprise-repository.js';

export type AuthTokenPayload = {
  sub: string;
  email: string;
  role: Role;
  companyId?: string;
  assignedLocationIds?: string[];
};

const secret = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export function createToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, secret, { expiresIn: '8h' });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, secret) as AuthTokenPayload;
}
