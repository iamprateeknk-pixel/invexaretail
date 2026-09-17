export const WEBHOOK_EVENT_OPTIONS = [
  { value: 'stock.low', label: 'Low stock' },
  { value: 'transfer.updated', label: 'Transfer updated' },
  { value: 'purchase-order.received', label: 'PO received' },
  { value: 'count.reviewed', label: 'Count reviewed' },
];

export function displayWebhookEvent(value) {
  return WEBHOOK_EVENT_OPTIONS.find((entry) => entry.value === value)?.label ?? String(value ?? '');
}

export function displayDeliveryStatus(status) {
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'FAILED') return 'Failed';
  return 'Pending';
}

export function formatWebhookEvents(events) {
  if (!Array.isArray(events)) return String(events ?? '');
  return events.map(displayWebhookEvent).join(', ');
}
