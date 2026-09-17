import type { NextFunction, Request, Response } from 'express';
import { controlPlane } from './control-plane.js';

export const ENTITLEMENT_FEATURES = [
  'OMS',
  'ANALYTICS',
  'INTEGRATIONS',
  'PURCHASING',
  'ADVANCED_WORKFLOW',
  'WMS',
  'INVENTORY',
] as const;

export type EntitlementFeature = (typeof ENTITLEMENT_FEATURES)[number];

const FEATURE_SEGMENTS: Record<EntitlementFeature, Set<string>> = {
  OMS: new Set(['orders', 'fulfillments', 'checkout']),
  ANALYTICS: new Set(['intelligence', 'analytics']),
  INTEGRATIONS: new Set(['webhook-subscriptions', 'webhook-deliveries']),
  PURCHASING: new Set(['purchase-orders', 'suppliers', 'reorder-rules']),
  ADVANCED_WORKFLOW: new Set(['approval-rules', 'tolerance-rules', 'evidence-rules']),
  WMS: new Set(['transfers', 'waves', 'picks', 'putaway', 'receiving', 'picker', 'picker-tasks', 'pick-waves', 'putaway-tasks', 'bins']),
  INVENTORY: new Set(['stock', 'items', 'counts', 'imports', 'locations', 'opening-stock', 'stock-adjustments', 'stock-takes', 'cycle-counts']),
};

export const NAV_ENTITLEMENTS: Record<string, EntitlementFeature> = {
  orders: 'OMS',
  intelligence: 'ANALYTICS',
  integrations: 'INTEGRATIONS',
  'purchase-orders': 'PURCHASING',
  transfers: 'WMS',
  picking: 'WMS',
  putaway: 'WMS',
  inventory: 'INVENTORY',
  counts: 'INVENTORY',
  expiry: 'INVENTORY',
  'stock-update': 'INVENTORY',
  catalog: 'INVENTORY',
};

function isAuthRoute(req: Request): boolean {
  return /\/auth\//.test(`${req.originalUrl ?? ''} ${req.path ?? ''}`);
}

export function featureForEntitlementPath(path: string): EntitlementFeature | null {
  const segments = String(path ?? '').split('/').filter(Boolean);
  for (const feature of ENTITLEMENT_FEATURES) {
    if (segments.some((segment) => FEATURE_SEGMENTS[feature].has(segment))) {
      return feature;
    }
  }
  return null;
}

export function isPlanEntitled(companyId: string, featureKey: string): boolean {
  const company = controlPlane.companies.get(companyId);
  if (!company) return false;
  const plan = controlPlane.plans.get(company.planId);
  const fromPlan = plan?.modules[featureKey] ?? plan?.capabilities[featureKey] ?? false;
  const companyValue = controlPlane.entitlements.get(companyId)?.[featureKey];
  return companyValue ?? fromPlan;
}

export function hiddenNavigationForModules(modules: Record<string, boolean>): string[] {
  return Object.entries(NAV_ENTITLEMENTS)
    .filter(([, feature]) => modules[feature] === false)
    .map(([id]) => id);
}

export function planModulesForCompany(companyId: string): Record<string, boolean> {
  return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, isPlanEntitled(companyId, feature)]));
}

export function hiddenNavigationForCompany(companyId: string): string[] {
  return hiddenNavigationForModules(planModulesForCompany(companyId));
}

export function enforcePlanEntitlements(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || isAuthRoute(req)) {
    next();
    return;
  }
  const companyId = req.companyId;
  if (!companyId) {
    next();
    return;
  }
  const feature = featureForEntitlementPath(req.path ?? '');
  if (!feature || isPlanEntitled(companyId, feature)) {
    next();
    return;
  }
  res.status(403).json({
    error: `${feature} is not included in this company's plan`,
    code: 'FEATURE_NOT_ENTITLED',
    feature,
  });
}
