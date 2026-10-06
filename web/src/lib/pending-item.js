// Hands an item picked in the command palette to the Item Search page,
// which mounts after navigation and so cannot receive it as a prop.
const KEY = 'invexa.pendingItem';

function storage() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function setPendingItem(item) {
  const store = storage();
  if (!store || !item?.id) return;
  try { store.setItem(KEY, JSON.stringify({ id: item.id, name: item.name, code: item.code })); } catch { /* storage unavailable */ }
}

export function takePendingItem() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    store.removeItem(KEY);
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}
