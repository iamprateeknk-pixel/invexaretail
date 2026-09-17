import type { NextFunction, Request, Response } from 'express';
export declare const MEMORY_MODE_UNAVAILABLE: {
    readonly code: "MEMORY_MODE";
    readonly message: "This feature requires a connected database.";
};
export declare function isMemoryImplementedPath(path: string, method: string): boolean;
export declare function memoryGetPayload(path: string): Record<string, unknown> | null;
export declare function respondWhenMemoryUnavailable(req: Request, res: Response, next: NextFunction): void;
