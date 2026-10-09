// One place that turns an Item row (with its lots) into the ItemRecord the API serves. Used by snapshot hydration
// (lib/persistence.ts) and by the database-first item repository, so the two cannot drift apart.
import type { ItemRecord } from './repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function itemRowToRecord(item: any): ItemRecord {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category ?? undefined,
    subcategory: item.subcategory ?? undefined,
    company: item.company ?? undefined,
    unit: item.unit ?? undefined,
    countMethod: item.countMethod ?? 'LOT_SCAN',
    pickMethod: item.pickMethod ?? 'LOT_SCAN',
    allocationStrategy: item.allocationStrategy ?? 'FEFO',
    lotRequired: item.lotRequired ?? true,
    expiryRequired: item.expiryRequired ?? false,
    decimalQuantity: item.decimalQuantity ?? false,
    status: (item.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
    archiveReason: item.archiveReason ?? undefined,
    archivedAt: item.archivedAt?.toISOString(),
    archivedById: item.archivedById ?? undefined,
    barcode: item.barcode ?? undefined,
    hsn: item.hsn ?? undefined,
    gstRate: item.gstRate ?? undefined,
    mrp: item.mrp == null ? undefined : Number(item.mrp),
    leadTimeDays: item.leadTimeDays ?? undefined,
    shelfLifeDays: item.shelfLifeDays ?? undefined,
    aliases: Array.isArray(item.aliases) ? (item.aliases as string[]) : undefined,
    version: item.version ?? 1,
    createdById: item.createdById ?? undefined,
    updatedById: item.updatedById ?? undefined,
    lots: item.lots.map((lot) => ({
      id: lot.id,
      itemId: lot.itemId,
      lotNo: lot.lotNo,
      expiryDate: lot.expiryDate?.toISOString() ?? null,
      status: (lot.status as 'AVAILABLE' | 'EXPIRED' | 'BLOCKED' | 'QUARANTINE') ?? 'AVAILABLE',
      attributes: (lot.attributes as Record<string, unknown> | null) ?? undefined,
    })),
  };
}
