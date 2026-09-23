// Week 9: one source of truth for "can this role, with these hidden
// modules, see or open this section" - derived from lib/workspace.js's
// NAVIGATION table (which already carries per-item `roles`/`adminOnly`),
// instead of duplicating the rule in a second, hand-maintained table.
//
// Before this module existed, the app had TWO separate answers to "can
// role X open section Y":
//   1. NAVIGATION[].items[].roles - used to decide whether to SHOW the nav
//      link (lib/workspace.js's navigationItemIsVisible).
//   2. Workspace.jsx's local SECTION_ROLES map - used to decide whether to
//      RENDER the page if activeSection is already set to it.
// These two answers could disagree, and did: SECTION_ROLES only listed 9
// of NAVIGATION's ~26 sections, so a section like 'putaway' or
// 'stock-update' (both role-restricted in NAVIGATION) had NO route-level
// guard at all - typing '#/putaway' into the address bar rendered the full
// warehouse putaway workspace for a Store User, even though the nav
// correctly hid the link. hiddenModules (pack/entitlement hiding) was
// checked for nav visibility but never for route rendering either.
// activeSection is driven directly by the URL hash (useSectionRoute.js),
// which is entirely client-controlled, so this was a real gap between what
// the nav showed and what a direct URL could reach - not a data leak (the
// API re-checks role/entitlement server-side on every request regardless),
// but a real UI gap this module exists to close by construction: nav
// visibility and route access can no longer be computed two different ways
// because they are now the same function.
import { NAVIGATION, navigationItemIsVisible } from './workspace.js';

const NAV_ITEM_BY_ID = new Map(NAVIGATION.flatMap((group) => group.items).map((item) => [item.id, item]));

/**
 * The single check both the nav (visibleNavigationGroups) and the route
 * guard (Workspace.jsx) call. A section with no NAVIGATION entry (there
 * are none today - workspace.test.js's "navigation ids stay inside the
 * hash-route catalog" test asserts NAVIGATION and APP_SECTIONS are the
 * same set) is treated as open, matching the pre-Week-9 fallback behavior
 * for an unrecognized id rather than inventing a new failure mode.
 */
export function canAccessSection(sectionId, { role, hiddenModules = new Set() } = {}) {
  const item = NAV_ITEM_BY_ID.get(sectionId);
  if (!item) return true;
  return navigationItemIsVisible(item, { role, hiddenModules });
}

/** The first section a role should land on. Every role's home is the shared operations dashboard today - see docs/web/role-journeys.md for why a role-specific landing page is deliberately not built this week. */
export function getRoleHome(_role) {
  return 'dashboard';
}
