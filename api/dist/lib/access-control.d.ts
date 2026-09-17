import type { NextFunction, Request, Response } from 'express';
export declare const PERMISSION_MODULES: readonly ["STOCK", "COUNT", "TRANSFER", "IMPORT", "REPORT", "EXPIRY", "PURCHASE", "WORK", "ADMIN"];
export declare const PERMISSION_ACTIONS: readonly ["VIEW", "CREATE", "EDIT", "DELETE", "APPROVE", "EXPORT", "ARCHIVE", "REVERSE"];
export type PermissionModule = typeof PERMISSION_MODULES[number];
export type PermissionAction = typeof PERMISSION_ACTIONS[number];
export declare function classifyPermission(method: string, path: string): {
    module: PermissionModule;
    action: PermissionAction;
} | null;
export declare function enforcePermissionOverrides(req: Request, res: Response, next: NextFunction): Promise<void>;
