// Inventory valuation and health KPIs (audit O-5). Before this the system could not answer the
// first questions an owner asks: how much money is sitting in stock, how fast does it turn, what
// is dead, how old is it. Deterministic and read-only: every number is a plain aggregate over the
// ledger rows and the sales movements passed in.

export type HealthStockRow = {
  itemId: string;
  code: string;
  name: string;
  category: string | null;
  onHand: number;
  /** Cost per unit (landed cost when known, else purchase rate); null when the lot has no recorded cost. */
  unitCost: number | null;
  /** When the lot arrived, for ageing. */
  lotCreatedAt: Date | string | null;
};

export type HealthSales = { units: number; cogs: number };

/** NO_DATA: no sales movements exist at all for the window, so we cannot tell dead from unrecorded - we say so instead of calling everything dead. */
export type ItemHealthStatus = 'DEAD' | 'SLOW' | 'HEALTHY' | 'NO_STOCK' | 'NO_DATA';

export type InventoryHealth = {
  windowDays: number;
  valuation: {
    totalValue: number;
    valuedUnits: number;
    /** Units whose lot has no cost: they are NOT in totalValue (we do not guess a price). */
    unvaluedUnits: number;
    byCategory: Array<{ category: string; value: number; units: number }>;
  };
  /** Annualised: (cost of goods sold in the window x 365/window) / current inventory value. Null with no value or no sales. */
  turns: number | null;
  daysOfInventory: number | null;
  ageing: Array<{ bucket: '0-30' | '31-90' | '91-180' | '181+'; value: number; units: number }>;
  items: Array<{ itemId: string; code: string; name: string; onHand: number; value: number; unitsSold: number; avgDailyDemand: number; daysOfCover: number | null; status: ItemHealthStatus }>;
  deadStock: { items: number; value: number; units: number };
  slowStock: { items: number; value: number; units: number };
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const DAY = 86_400_000;
/** More than this many days of cover at the current sales rate is slow-moving stock. */
export const SLOW_COVER_DAYS = 180;

function bucketFor(ageDays: number): InventoryHealth['ageing'][number]['bucket'] {
  if (ageDays <= 30) return '0-30';
  if (ageDays <= 90) return '31-90';
  if (ageDays <= 180) return '91-180';
  return '181+';
}

export function buildInventoryHealth(input: { rows: HealthStockRow[]; sales: Map<string, HealthSales>; windowDays: number; hasSalesData?: boolean; now?: Date }): InventoryHealth {
  const hasSalesData = input.hasSalesData ?? input.sales.size > 0;
  const now = input.now ?? new Date();
  const windowDays = Math.max(1, input.windowDays);
  const byItem = new Map<string, { code: string; name: string; onHand: number; value: number }>();
  const byCategory = new Map<string, { value: number; units: number }>();
  const ageing = new Map<string, { value: number; units: number }>(['0-30', '31-90', '91-180', '181+'].map((bucket) => [bucket, { value: 0, units: 0 }]));
  let totalValue = 0;
  let valuedUnits = 0;
  let unvaluedUnits = 0;

  for (const row of input.rows) {
    if (!(row.onHand > 0)) continue;
    const value = row.unitCost !== null ? row.onHand * row.unitCost : 0;
    if (row.unitCost !== null) { totalValue += value; valuedUnits += row.onHand; } else unvaluedUnits += row.onHand;
    const item = byItem.get(row.itemId) ?? { code: row.code, name: row.name, onHand: 0, value: 0 };
    item.onHand += row.onHand;
    item.value += value;
    byItem.set(row.itemId, item);
    const category = row.category?.trim() || 'Uncategorised';
    const cat = byCategory.get(category) ?? { value: 0, units: 0 };
    cat.value += value;
    cat.units += row.onHand;
    byCategory.set(category, cat);
    const created = row.lotCreatedAt ? new Date(row.lotCreatedAt).getTime() : NaN;
    const age = Number.isFinite(created) ? Math.max(0, Math.floor((now.getTime() - created) / DAY)) : 0;
    const bucket = ageing.get(bucketFor(age))!;
    bucket.value += value;
    bucket.units += row.onHand;
  }

  let cogs = 0;
  for (const sale of input.sales.values()) cogs += sale.cogs;
  const turns = totalValue > 0 && cogs > 0 ? round2((cogs * (365 / windowDays)) / totalValue) : null;
  const daysOfInventory = totalValue > 0 && cogs > 0 ? round2(totalValue / (cogs / windowDays)) : null;

  const items = [...byItem.entries()].map(([itemId, item]) => {
    const sold = input.sales.get(itemId)?.units ?? 0;
    const avgDailyDemand = sold / windowDays;
    const daysOfCover = avgDailyDemand > 0 ? round2(item.onHand / avgDailyDemand) : null;
    const status: ItemHealthStatus = item.onHand <= 0 ? 'NO_STOCK' : !hasSalesData ? 'NO_DATA' : sold <= 0 ? 'DEAD' : (daysOfCover ?? 0) > SLOW_COVER_DAYS ? 'SLOW' : 'HEALTHY';
    return { itemId, code: item.code, name: item.name, onHand: item.onHand, value: round2(item.value), unitsSold: sold, avgDailyDemand: round2(avgDailyDemand), daysOfCover, status };
  }).sort((a, b) => b.value - a.value || a.code.localeCompare(b.code));

  const sum = (status: ItemHealthStatus) => {
    const rows = items.filter((item) => item.status === status);
    return { items: rows.length, value: round2(rows.reduce((total, row) => total + row.value, 0)), units: rows.reduce((total, row) => total + row.onHand, 0) };
  };

  return {
    windowDays,
    valuation: {
      totalValue: round2(totalValue), valuedUnits, unvaluedUnits,
      byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, value: round2(v.value), units: v.units })).sort((a, b) => b.value - a.value),
    },
    turns,
    daysOfInventory,
    ageing: [...ageing.entries()].map(([bucket, v]) => ({ bucket: bucket as InventoryHealth['ageing'][number]['bucket'], value: round2(v.value), units: v.units })),
    items,
    deadStock: sum('DEAD'),
    slowStock: sum('SLOW'),
  };
}

/** Unit cost from lot attributes: landed cost first, then the purchase rate; null when neither is recorded. */
export function lotUnitCost(attributes: Record<string, unknown> | null | undefined): number | null {
  for (const key of ['landedUnitCost', 'purchaseRate']) {
    const value = Number(attributes?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}
