import type { NextFunction, Request, Response } from 'express';
export declare function isCompanySuspended(companyId: string | null | undefined): boolean;
export declare function rejectSuspendedCompany(companyId: string | null | undefined, res: Response): boolean;
export declare function enforceSuspendedCompany(req: Request, res: Response, next: NextFunction): void;
export declare function enforcePlanLimits(req: Request, res: Response, next: NextFunction): void;
export declare function enforceApiUsage(req: Request, res: Response, next: NextFunction): void;
