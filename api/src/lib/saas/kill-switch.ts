import type { NextFunction, Request, Response } from 'express';
import { controlPlane } from './control-plane.js';

export const KILLABLE_FEATURES = ['INVENTORY', 'WMS', 'OMS'] as const;
export type KillableFeature = (typeof KILLABLE_FEATURES)[number];

const INVENTORY_SEGMENTS = new Set([
  'stock',
  'items',
  'counts',
  'imports',
  'locations',
  'opening-stock',
]);
const WMS_SEGMENTS = new Set([
  'transfers',
  'waves',
  'picks',
  'putaway',
  'receiving',
]);
const OMS_SEGMENTS = new Set([
  'orders',
  'fulfillments',
  'checkout',
]);

export function featureForOperationalPath(path: string): KillableFeature | null {
  const segments = String(path ?? '').split('/').filter(Boolean);
  for (const segment of segments) {
    if (INVENTORY_SEGMENTS.has(segment)) return 'INVENTORY';
    if (WMS_SEGMENTS.has(segment)) return 'WMS';
    if (OMS_SEGMENTS.has(segment)) return 'OMS';
  }
  return null;
}

export function isOperationalKillSwitchOn(feature: string): boolean {
  return controlPlane.safety.get(feature) === false;
}

export function enforceOperationalKillSwitches(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const feature = featureForOperationalPath(req.path ?? '');
  if (!feature || !isOperationalKillSwitchOn(feature)) {
    next();
    return;
  }
  res.status(403).json({
    error: `${feature} mutations are disabled by a platform kill switch`,
    code: 'KILL_SWITCH',
    feature,
  });
}
