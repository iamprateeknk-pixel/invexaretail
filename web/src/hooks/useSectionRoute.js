import { useCallback, useEffect, useState } from 'react';

export const APP_SECTIONS = Object.freeze([
  'dashboard', 'inventory', 'item-search', 'inventory-health', 'stock-update', 'import-wizard', 'expiry', 'catalog',
  'counts', 'campaigns', 'transfers', 'picking', 'putaway', 'purchase-orders', 'orders', 'qc', 'assets', 'jobs',
  'command-center', 'approvals', 'reports', 'intelligence', 'exceptions', 'alerts', 'integrations', 'connectors', 'saas', 'admin', 'entity',
]);

/** Routable sections that are reached by links (a lot, a transfer...) rather than from the sidebar. */
export const LINK_ONLY_SECTIONS = Object.freeze(['entity']);

export function sectionFromHash(hash = '') {
  const candidate = String(hash).replace(/^#\/?/, '').split(/[?&]/, 1)[0].trim();
  return APP_SECTIONS.includes(candidate) ? candidate : 'dashboard';
}

export function sectionHash(section) {
  return `#/${sectionFromHash(`#/${section}`)}`;
}

export function useSectionRoute() {
  const [section, setSection] = useState(() => sectionFromHash(window.location.hash));

  useEffect(() => {
    const syncFromLocation = () => setSection(sectionFromHash(window.location.hash));
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, []);

  const navigate = useCallback((nextSection, { replace = false } = {}) => {
    const next = sectionFromHash(`#/${nextSection}`);
    setSection(next);
    const nextHash = sectionHash(next);
    if (window.location.hash === nextHash) return;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', nextHash);
  }, []);

  return [section, navigate];
}
