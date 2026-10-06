// Virtual bundles/kits: a bundle item owns no stock; how many can be sold is
// limited by its scarcest component. Pure functions - no database access.
export type BundleComponentInput = { itemId: string; quantity: number };

export type BundleAvailability = {
  /** Whole bundles that can be assembled from current component stock. */
  buildable: number;
  /** The component that runs out first, or null when the bundle has no components. */
  limitingItemId: string | null;
};

export function bundleAvailability(components: BundleComponentInput[], availableByItem: Map<string, number>): BundleAvailability {
  if (!components.length) return { buildable: 0, limitingItemId: null };
  let buildable = Number.POSITIVE_INFINITY;
  let limitingItemId: string | null = null;
  for (const component of components) {
    const available = Math.max(0, availableByItem.get(component.itemId) ?? 0);
    const possible = Math.floor(available / component.quantity);
    if (possible < buildable) {
      buildable = possible;
      limitingItemId = component.itemId;
    }
  }
  return { buildable, limitingItemId };
}

export type BundleDefinitionError = { code: 'EMPTY' | 'SELF_REFERENCE' | 'DUPLICATE_COMPONENT' | 'INVALID_QUANTITY' | 'NESTED_BUNDLE'; message: string };

/**
 * `componentsThatAreBundles` is the subset of component ids that are themselves
 * bundles - nesting is rejected so availability never needs recursion.
 */
export function validateBundleDefinition(
  bundleItemId: string,
  components: BundleComponentInput[],
  componentsThatAreBundles: ReadonlySet<string> = new Set(),
): BundleDefinitionError | null {
  if (!components.length) return { code: 'EMPTY', message: 'A bundle needs at least one component.' };
  const seen = new Set<string>();
  for (const component of components) {
    if (component.itemId === bundleItemId) return { code: 'SELF_REFERENCE', message: 'A bundle cannot contain itself.' };
    if (seen.has(component.itemId)) return { code: 'DUPLICATE_COMPONENT', message: 'Each component can appear only once.' };
    seen.add(component.itemId);
    if (!Number.isFinite(component.quantity) || component.quantity <= 0) return { code: 'INVALID_QUANTITY', message: 'Component quantities must be positive numbers.' };
    if (componentsThatAreBundles.has(component.itemId)) return { code: 'NESTED_BUNDLE', message: 'A component cannot itself be a bundle.' };
  }
  return null;
}
