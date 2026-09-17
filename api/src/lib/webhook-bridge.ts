import { controlPlane } from './saas/control-plane.js';
import { DEFAULT_COMPANY_ID, ownerOfItem, ownerOfLocation } from './saas/tenant-scope.js';
import type { WebhookEventType } from './webhook-events.js';

export type ControlPlaneWebhookTarget = {
  id: string;
  name: string;
  url: string;
  signingSecret: string;
  createdAt: string;
};

const LOCATION_KEYS = ['locationId', 'sourceLocationId', 'destinationLocationId', 'fromLocationId', 'toLocationId'];
const ITEM_KEYS = ['itemId'];

export function resolveCompanyIdFromEvent(data: Record<string, unknown> = {}): string | undefined {
  for (const key of LOCATION_KEYS) {
    const value = data[key];
    if (typeof value === 'string' && value) {
      const owner = ownerOfLocation(value);
      if (owner) return owner;
    }
  }
  for (const key of ITEM_KEYS) {
    const value = data[key];
    if (typeof value === 'string' && value) {
      const owner = ownerOfItem(value);
      if (owner) return owner;
    }
  }
  if (typeof data.companyId === 'string' && data.companyId) return data.companyId;
  return undefined;
}

export function listControlPlaneWebhookTargets(companyId: string, eventType: string): ControlPlaneWebhookTarget[] {
  const scoped = companyId || DEFAULT_COMPANY_ID;
  return [...controlPlane.webhooks.values()]
    .filter((hook) => hook.companyId === scoped && hook.status === 'active' && hook.events.includes(eventType as WebhookEventType))
    .map((hook) => ({
      id: hook.id,
      name: hook.name,
      url: hook.url,
      signingSecret: hook.signingSecret,
      createdAt: hook.createdAt,
    }));
}
