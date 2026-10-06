// `target.splice(0, target.length, ...source)` and `target.push(...source)` pass
// every element as a separate call argument, and V8 throws
// "RangeError: Maximum call stack size exceeded" once that is roughly 120,000
// elements. Startup hydration used that pattern for the in-memory stock ledger,
// so a database with enough rows could not finish hydrating and every
// operational request returned 503. These helpers do the same job in chunks.
const CHUNK = 10_000;

/** Appends every element of `source` to `target` without spreading it as arguments. */
export function pushAll<T>(target: T[], source: readonly T[]): T[] {
  for (let offset = 0; offset < source.length; offset += CHUNK) {
    target.push(...source.slice(offset, offset + CHUNK));
  }
  return target;
}

/** Replaces the contents of `target` in place (callers hold references to the array). */
export function replaceContents<T>(target: T[], source: readonly T[]): T[] {
  // Copy first: `source` may be derived from, or even be, `target`.
  const next = source === target ? source.slice() : source;
  target.length = 0;
  return pushAll(target, next);
}
