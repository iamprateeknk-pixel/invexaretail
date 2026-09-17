export type BinLike = {
    code: string;
    zone?: string | null;
    aisle?: string | null;
    rack?: string | null;
    shelf?: string | null;
} | null;
/** Pure and unit-testable: turns a bin's hierarchy into a sortable walking-order key. Bin-less items sort last. */
export declare function sequenceKeyForBin(bin: BinLike): string;
/**
 * Best-effort bin lookup for an item/lot at a location, from putaway
 * history: prefer the most recently confirmed bin for this exact lot, else
 * any confirmed bin for the item at this location. Returns null (never
 * throws) when nothing has ever been put away yet - the caller still
 * builds the pick list, just without a walking-order hint for that line.
 */
export type LookedUpBin = {
    id: string;
    code: string;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
} | null;
export declare function lastKnownBin(locationId: string, itemId: string, lotId: string): Promise<LookedUpBin>;
