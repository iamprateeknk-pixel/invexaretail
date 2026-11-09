import type { NextFunction, Request, Response } from 'express';
import { controlPlane } from './control-plane.js';
import { refreshKillSwitchesFromDb } from './control-plane-repository.js';

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

export async function enforceOperationalKillSwitches(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const feature = featureForOperationalPath(req.path ?? '');
  if (feature) {
    // ULTRA P2: re-read kill switches from the database in DB mode, so a
    // switch set on another replica is honoured on this one immediately
    // instead of at the next restart. Fail-soft: a refresh error keeps the
    // in-memory map (the background refresh retries on its next tick).
    await refreshKillSwitchesFromDb(controlPlane).catch(() => false);
  }
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
