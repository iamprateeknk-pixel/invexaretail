import type { AutomationDefinition } from './control-plane.js';
import { isStudioSchedule } from './studio-schedule.js';

export const STUDIO_EVENT_MESSAGES = {
  'count.submitted': 'A stock count was submitted.',
  'transfer.created': 'A transfer was created.',
  'order.created': 'A sales order was created.',
  'item.near_expiry': 'A stocked lot is approaching expiry.',
  'inventory.low_stock': 'Stock has reached its reorder level.',
} as const;

export type StudioBusinessEvent = keyof typeof STUDIO_EVENT_MESSAGES;

export function isStudioBusinessEvent(expression: string): expression is StudioBusinessEvent {
  return Object.hasOwn(STUDIO_EVENT_MESSAGES, expression);
}

export function validateLiveAutomation(automation: AutomationDefinition): void {
  if (automation.enforce !== true) return;
  const supported = automation.trigger === 'schedule' ? isStudioSchedule(automation.expression)
    : automation.trigger === 'event' && isStudioBusinessEvent(automation.expression);
  if (!supported || automation.actionKey !== 'SEND_NOTIFICATION') {
    throw new Error('Live in-app notifications require a supported event or schedule and the notification action.');
  }
  if (typeof automation.key !== 'string' || !automation.key.trim() || automation.key.length > 100 ||
      typeof automation.name !== 'string' || !automation.name.trim() || automation.name.length > 160) {
    throw new Error('Give the automation a key and a name of 160 characters or fewer.');
  }
}

export function enabledStudioAutomations(payload: unknown): AutomationDefinition[] {
  if (!payload || typeof payload !== 'object' || !('automations' in payload) || !Array.isArray(payload.automations)) return [];
  return payload.automations.filter((row): row is AutomationDefinition => {
    if (row?.enforce !== true) return false;
    try {
      validateLiveAutomation(row);
      return true;
    } catch {
      return false;
    }
  });
}
