import { prisma } from './db.js';

// Blueprint Module C / section 9.2 (Pick Waves): "Guided sequence by
// zone/rack/bin to reduce walking." A wave's combined pick list is ordered
// by where each item/lot was last put away, so a picker walks the
// warehouse once in a sensible order instead of re-walking it per transfer.

export type BinLike = { code: string; zone?: string | null; aisle?: string | null; rack?: string | null; shelf?: string | null } | null;

/** Pure and unit-testable: turns a bin's hierarchy into a sortable walking-order key. Bin-less items sort last. */
export function sequenceKeyForBin(bin: BinLike): string {
  if (!bin) return '~unassigned';
  return [bin.zone, bin.aisle, bin.rack, bin.shelf, bin.code].filter(Boolean).join('-');
}

/**
 * Best-effort bin lookup for an item/lot at a location, from putaway
 * history: prefer the most recently confirmed bin for this exact lot, else
 * any confirmed bin for the item at this location. Returns null (never
 * throws) when nothing has ever been put away yet - the caller still
 * builds the pick list, just without a walking-order hint for that line.
 */
export type LookedUpBin = { id: string; code: string; zone: string | null; aisle: string | null; rack: string | null; shelf: string | null } | null;

export async function lastKnownBin(locationId: string, itemId: string, lotId: string): Promise<LookedUpBin> {
  try {
    const lotMatch = await prisma.putawayTask.findFirst({
      where: { locationId, itemId, lotId, status: 'CONFIRMED', confirmedBinId: { not: null } },
      orderBy: { confirmedAt: 'desc' },
      include: { confirmedBin: true },
    });
    if (lotMatch?.confirmedBin) return lotMatch.confirmedBin;
    const itemMatch = await prisma.putawayTask.findFirst({
      where: { locationId, itemId, status: 'CONFIRMED', confirmedBinId: { not: null } },
      orderBy: { confirmedAt: 'desc' },
      include: { confirmedBin: true },
    });
    return itemMatch?.confirmedBin ?? null;
  } catch {
    return null;
  }
}
