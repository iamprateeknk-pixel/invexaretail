import { type Request, type Response, type NextFunction } from 'express';
import * as repo from '../lib/enterprise-repository.js';
declare const router: import("express-serve-static-core").Router;
declare global {
    namespace Express {
        interface Request {
            userId?: string;
            companyId?: string;
            user?: repo.EnhancedUserRecord;
            rawBody?: string;
            apiKey?: {
                id: string;
                companyId: string;
                name: string;
                prefix: string;
                scopes: string[];
            };
        }
    }
}
export declare function extractToken(req: Request, res: Response, next: NextFunction): void;
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export default router;
