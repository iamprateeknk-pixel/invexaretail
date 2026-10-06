// "Needs attention" ordering for the Today home and the first-run
// checklist. Pure functions over data the dashboard already holds.
const URGENCY = ['Open exceptions', 'Expiry risk', 'Low stock', 'Discrepancy risk', 'Pending counts', 'Pending approvals', 'Transfer requests'];

export function buildAttentionList(cards, limit = 4) {
  return (cards ?? [])
    .filter((card) => Number(card.value) > 0 && URGENCY.includes(card.label))
    .sort((a, b) => URGENCY.indexOf(a.label) - URGENCY.indexOf(b.label))
    .slice(0, limit);
}

const PLAN_ROLES = ['ADMIN', 'ADMIN_USER'];

// Low stock is a prompt to reorder: admins land on the purchase plan (which
// drafts POs from reorder rules); everyone else keeps the stock view.
export function attentionTarget(card, role) {
  return card.label === 'Low stock' && PLAN_ROLES.includes(role) ? 'purchase-orders' : card.section;
}

export function onboardingSteps({ locationCount = 0, itemCount = 0, hasStock = false, hasMovement = false } = {}) {
  return [
    { id: 'location', label: 'Add your first location', section: 'admin', done: locationCount > 0 },
    { id: 'item', label: 'Add or import your items', section: 'catalog', done: itemCount > 0 },
    { id: 'stock', label: 'Load opening stock', section: 'import-wizard', done: hasStock },
    { id: 'move', label: 'Make your first stock move', section: 'transfers', done: hasMovement },
  ];
}

export function onboardingProgress(steps) {
  const done = steps.filter((step) => step.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}
