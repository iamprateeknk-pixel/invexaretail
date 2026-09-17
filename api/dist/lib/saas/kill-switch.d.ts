import type { NextFunction, Request, Response } from 'express';
export declare const KILLABLE_FEATURES: readonly ["INVENTORY", "WMS", "OMS"];
export type KillableFeature = (typeof KILLABLE_FEATURES)[number];
export declare function featureForOperationalPath(path: string): KillableFeature | null;
export declare function isOperationalKillSwitchOn(feature: string): boolean;
export declare function enforceOperationalKillSwitches(req: Request, res: Response, next: NextFunction): void;
