import type { NextFunction, Request, Response } from 'express';

import { databaseEnabled } from './persistence.js';

export const MEMORY_MODE_UNAVAILABLE = {
  code: 'MEMORY_MODE',
  message: 'This feature requires a connected database.',
} as const;

function requestPath(req: Pick<Request, 'path' | 'url'>): string {
  const raw = (req.path || req.url || '').split('?')[0];
  return raw.replace(/^\/api\/v1/, '') || '/';
}

export function isMemoryImplementedPath(path: string, method: string): boolean {
  const verb = method.toUpperCase();
  if (path === '/expiry-alerts' && verb === 'GET') return true;
  if (path === '/expiry-board' && verb === 'GET') return true;
  if (path === '/expiry-write-off' && verb === 'POST') return true;
  if (/^\/lots\/[^/]+\/(status|expiry)$/.test(path) && verb === 'PATCH') return true;
  if (/^\/intelligence\/[^/]+$/.test(path) && verb === 'GET') return true;
  if (/^\/intelligence\/[^/]+\/dismiss$/.test(path) && verb === 'POST') return true;
  if (path === '/saas/plans' && verb === 'GET') return true;
  if (path === '/saas/tenants' && verb === 'GET') return true;
  if (path === '/saas/onboard' && verb === 'POST') return true;
  if (path === '/connectors' && (verb === 'GET' || verb === 'POST')) return true;
  if (/^\/connectors\/[^/]+\/ingest$/.test(path) && verb === 'POST') return true;
  if (path === '/mobile/home' && verb === 'GET') return true;
  if ((path === '/orders' || path === '/qc-templates') && (verb === 'GET' || verb === 'POST')) return true;
  if (/^\/qc-templates\/[^/]+$/.test(path) && verb === 'PATCH') return true;
  if (path === '/qc-inspections' && (verb === 'GET' || verb === 'POST')) return true;
  if (/^\/locations\/[^/]+\/bin-stock$/.test(path) && verb === 'GET') return true;
  if (/^\/locations\/[^/]+\/bins$/.test(path) && (verb === 'GET' || verb === 'POST')) return true;
  if (/^\/pick-waves\/[^/]+\/scan$/.test(path) && verb === 'POST') return true;
  if (path === '/reorder-rules' && verb === 'GET') return true;
  if (/^\/reorder-rules\/[^/]+$/.test(path) && verb === 'PUT') return true;
  if (path === '/webhook-subscriptions' && (verb === 'GET' || verb === 'POST')) return true;
  if (/^\/webhook-subscriptions\/[^/]+\/status$/.test(path) && verb === 'PATCH') return true;
  if (path === '/webhook-deliveries' && verb === 'GET') return true;
  return false;
}

export function memoryGetPayload(path: string): Record<string, unknown> | null {
  if (path === '/asset-checkouts') return { checkouts: [] };
  if (path === '/jobs') return { jobs: [] };
  if (path === '/catalog/tags') return { tags: [] };
  if (path === '/catalog/custom-fields') return { fields: [] };
  if (path === '/catalog/custom-field-values') return { values: {} };
  if (path === '/suppliers') return { suppliers: [] };
  if (path === '/purchase-orders') return { purchaseOrders: [] };
  if (path === '/orders') return { orders: [] };
  if (path === '/saved-reports') return { savedReports: [] };
  if (path === '/notification-inbox') return { notifications: [] };
  if (/^\/catalog\/items\/[^/]+$/.test(path)) return { tags: [], customFields: [] };
  if (/^\/comments\/[^/]+\/[^/]+$/.test(path)) return { comments: [] };
  if (path === '/saas/plans') return { plans: [] };
  if (path === '/saas/tenants') return { tenants: [] };
  if (path === '/connectors') return { connectors: [] };
  if (path === '/mobile/home') return { home: { title: 'Invexa Retail', destinations: [] } };
  if (path === '/qc-templates') return { templates: [] };
  if (path === '/qc-inspections') return { inspections: [] };
  return null;
}

export function respondWhenMemoryUnavailable(req: Request, res: Response, next: NextFunction): void {
  if (databaseEnabled) {
    next();
    return;
  }
  if (isMemoryImplementedPath(requestPath(req), req.method)) {
    next();
    return;
  }
  if (req.method === 'GET') {
    const payload = memoryGetPayload(requestPath(req));
    if (payload) {
      res.json(payload);
      return;
    }
  }
  res.status(501).json({
    message: MEMORY_MODE_UNAVAILABLE.message,
    code: MEMORY_MODE_UNAVAILABLE.code,
  });
}
