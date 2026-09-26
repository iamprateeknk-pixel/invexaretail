import { serviceLevelZ } from './demand-forecast.js';

// Blueprint v4 §22 PO planning: "Demand + min/max + open PO + in-transit +
// safety stock", §28 "Explain every recommendation: why, data window,
// assumptions, confidence/risk" and "Separate recommendation from execution".
// This only recommends. Creating a draft PO is a separate human action.

export type PlanInput = {
  itemId: string;
  code?: string;
  name?: string;
  onHand: number;
  reserved?: number;
  minQty: number;
  targetQty: number;
  openPoQty: number;
  inTransitQty: number;
  // Average units sold per day over `demandDays` days; undefined when there is no sales history.
  avgDailyDemand?: number;
  demandDays?: number;
  decimal?: boolean;
  unitCost?: number;
  supplierId?: string | null;
  /** Case pack / pallet layer: the order quantity is rounded UP to a multiple of this (audit O-4). */
  orderMultiple?: number | null;
};

export type SupplierTerms = {
  id: string; name: string; leadTimeDays?: number | null; moq?: number | null; status?: string | null;
  /** Lead time measured from this supplier's own completed orders (audit O-3). Used when no contractual lead time is set, and for its variability. */
  measured?: { samples: number; meanDays: number | null; stdDevDays: number | null } | null;
};

export type Suggestion = {
  itemId: string;
  code?: string;
  name?: string;
  supplierId: string | null;
  supplierName: string | null;
  quantity: number;
  urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
  position: number;
  reorderPoint: number;
  orderUpTo: number;
  leadTimeDays: number;
  daysOfCover: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedCost: number | null;
  // Plain-language reasoning, in the order it was worked out.
  explanation: string[];
};

export type PlanResult = { suggestions: Suggestion[]; skipped: Array<{ itemId: string; reason: string }> };

/** Purchase orders whose remaining quantity is still on its way: approved and awaiting, sent to the supplier, or part-received. */
export const OPEN_PO_STATUSES = ['SUBMITTED', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] as const;

export const DEFAULT_LEAD_TIME_DAYS = 7;
/** Fewer completed orders than this and a measured lead time is not trusted. */
export const MIN_LEAD_TIME_SAMPLES = 3;
export const DEFAULT_COVER_DAYS = 7;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const fmt = (value: number) => String(round3(value));

/**
 * Economic order quantity: sqrt(2 x annual demand x cost per order / annual holding cost per unit).
 * Null unless demand, unit cost and both cost parameters are known: it is never guessed.
 */
export function economicOrderQuantity(input: { dailyDemand: number; unitCost?: number | null; orderingCost?: number; holdingRate?: number }): number | null {
  const { dailyDemand, unitCost, orderingCost, holdingRate } = input;
  if (!(dailyDemand > 0) || !unitCost || unitCost <= 0 || !orderingCost || orderingCost <= 0 || !holdingRate || holdingRate <= 0) return null;
  return Math.sqrt((2 * dailyDemand * 365 * orderingCost) / (holdingRate * unitCost));
}

export function planPurchases(input: { items: PlanInput[]; suppliers: SupplierTerms[]; coverDays?: number; /** Cost of placing one order. With `holdingRate` (yearly fraction of unit cost) it switches EOQ on. */ orderingCost?: number; holdingRate?: number; /** Spending cap for this plan: most urgent lines are kept, the rest deferred (audit O-4). */ budget?: number }): PlanResult {
  const coverDays = input.coverDays ?? DEFAULT_COVER_DAYS;
  const suppliers = new Map(input.suppliers.map((supplier) => [supplier.id, supplier]));
  const suggestions: Suggestion[] = [];
  const skipped: PlanResult['skipped'] = [];

  for (const item of input.items) {
    const label = item.code ?? item.itemId;
    const supplier = item.supplierId ? suppliers.get(item.supplierId) : undefined;
    if (supplier && supplier.status && supplier.status !== 'ACTIVE') {
      skipped.push({ itemId: item.itemId, reason: `${label}: supplier ${supplier.name} is ${supplier.status.toLowerCase()}; pick another supplier.` });
    }
    const usableSupplier = supplier && (!supplier.status || supplier.status === 'ACTIVE') ? supplier : undefined;
    const measured = usableSupplier?.measured && usableSupplier.measured.samples >= MIN_LEAD_TIME_SAMPLES && usableSupplier.measured.meanDays ? usableSupplier.measured : null;
    const contractual = usableSupplier?.leadTimeDays && usableSupplier.leadTimeDays > 0 ? usableSupplier.leadTimeDays : null;
    const lead = contractual ?? (measured ? Math.ceil(measured.meanDays as number) : DEFAULT_LEAD_TIME_DAYS);
    const leadSource: 'contract' | 'measured' | 'default' = contractual ? 'contract' : measured ? 'measured' : 'default';
    const leadStd = measured?.stdDevDays ?? 0;
    const daily = Math.max(0, item.avgDailyDemand ?? 0);
    const available = Math.max(0, item.onHand - (item.reserved ?? 0));
    const position = available + Math.max(0, item.openPoQty) + Math.max(0, item.inTransitQty);
    const leadDemand = daily * lead;
    // Safety: the configured minimum, or - when this supplier's lead time is measurably variable - the
    // stock needed to ride out a late delivery at the 95% level, whichever is larger.
    const variabilitySafety = daily > 0 && leadStd > 0 ? serviceLevelZ(95) * daily * leadStd : 0;
    const safety = Math.max(Math.max(0, item.minQty), Math.ceil(variabilitySafety));
    const reorderPoint = Math.ceil(leadDemand) + safety;

    if (position > reorderPoint) {
      skipped.push({ itemId: item.itemId, reason: `${label}: covered - position ${fmt(position)} is above the reorder point ${fmt(reorderPoint)}.` });
      continue;
    }
    // Nothing to steer by: no rule and no demand means there is no basis to order.
    if (item.minQty <= 0 && item.targetQty <= 0 && daily <= 0) {
      skipped.push({ itemId: item.itemId, reason: `${label}: no reorder rule and no sales history to plan from.` });
      continue;
    }

    const orderUpTo = Math.max(item.targetQty, reorderPoint + Math.ceil(daily * coverDays));
    let quantity = orderUpTo - position;
    const notes: string[] = [];
    const eoq = economicOrderQuantity({ dailyDemand: daily, unitCost: item.unitCost, orderingCost: input.orderingCost, holdingRate: input.holdingRate });
    if (eoq !== null && quantity < eoq) {
      quantity = eoq;
      notes.push(`Raised to the economic order quantity of ${fmt(eoq)} (fewer, larger orders cost less at ${fmt(daily)}/day).`);
    }
    const moq = usableSupplier?.moq && usableSupplier.moq > 0 ? usableSupplier.moq : 0;
    if (moq && quantity < moq) {
      quantity = moq;
      notes.push(`Raised to the supplier minimum order of ${fmt(moq)}.`);
    }
    const multiple = item.orderMultiple && item.orderMultiple > 0 ? item.orderMultiple : 0;
    if (multiple && quantity % multiple !== 0) {
      quantity = Math.ceil(quantity / multiple) * multiple;
      notes.push(`Rounded up to a whole number of packs of ${fmt(multiple)}.`);
    }
    quantity = item.decimal ? round3(quantity) : Math.ceil(quantity);
    if (quantity <= 0) continue;

    const daysOfCover = daily > 0 ? round3(available / daily) : null;
    const window = item.demandDays ?? 0;
    const confidence: Suggestion['confidence'] = daily <= 0 ? 'LOW' : window >= 28 ? 'HIGH' : window >= 7 ? 'MEDIUM' : 'LOW';
    const urgency: Suggestion['urgency'] = position <= 0 ? 'CRITICAL' : position <= item.minQty ? 'HIGH' : 'NORMAL';

    const explanation = [
      `Position ${fmt(position)} = ${fmt(available)} available${item.reserved ? ` (after ${fmt(item.reserved)} reserved)` : ''} + ${fmt(item.openPoQty)} on open purchase orders + ${fmt(item.inTransitQty)} in transit.`,
      daily > 0
        ? `Reorder point ${fmt(reorderPoint)} = ${fmt(safety)} safety${safety > item.minQty ? ` (raised above the ${fmt(item.minQty)} minimum because this supplier's lead time varies by ~${fmt(leadStd)} days)` : ' minimum'} + ${fmt(Math.ceil(leadDemand))} expected sales over the ${lead}-day lead time (${fmt(daily)}/day${window ? ` over the last ${window} days` : ''}).`
        : `Reorder point ${fmt(reorderPoint)} = the ${fmt(item.minQty)} minimum; there is no sales history, so demand is not used.`,
      `Order up to ${fmt(orderUpTo)} (${orderUpTo === item.targetQty ? 'the target quantity' : `reorder point + ${coverDays} days of cover`}).`,
      ...notes,
      usableSupplier ? `Supplier ${usableSupplier.name}, lead time ${lead} days${leadSource === 'contract' ? '' : leadSource === 'measured' ? ` (measured over ${usableSupplier.measured!.samples} completed orders)` : ' (default - not set on the supplier and too few completed orders to measure)'}.` : `No usable supplier on record; the ${lead}-day default lead time was assumed.`,
    ];
    suggestions.push({
      itemId: item.itemId, code: item.code, name: item.name,
      supplierId: usableSupplier?.id ?? null, supplierName: usableSupplier?.name ?? null,
      quantity, urgency, position: round3(position), reorderPoint, orderUpTo: round3(orderUpTo), leadTimeDays: lead,
      daysOfCover, confidence, estimatedCost: item.unitCost ? round3(quantity * item.unitCost) : null, explanation,
    });
  }
  const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 } as const;
  suggestions.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity));
  if (input.budget !== undefined && input.budget >= 0) {
    // Most urgent first (already sorted); a line whose cost is unknown cannot be checked against the cap, so it is kept.
    let spent = 0;
    const kept: Suggestion[] = [];
    for (const suggestion of suggestions) {
      const cost = suggestion.estimatedCost ?? 0;
      if (spent + cost > input.budget) {
        skipped.push({ itemId: suggestion.itemId, reason: `${suggestion.code ?? suggestion.itemId}: deferred - ordering it (${fmt(cost)}) would take the plan past the budget of ${fmt(input.budget)}.` });
        continue;
      }
      spent += cost;
      kept.push(suggestion);
    }
    return { suggestions: kept, skipped };
  }
  return { suggestions, skipped };
}

export type SupplierGroup = { supplierId: string | null; supplierName: string | null; lines: Suggestion[]; estimatedTotal: number };

/** One proposed draft PO per supplier; items with no supplier are grouped for the buyer to assign. */
export function groupBySupplier(suggestions: Suggestion[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const suggestion of suggestions) {
    const key = suggestion.supplierId ?? '';
    const group = groups.get(key) ?? { supplierId: suggestion.supplierId, supplierName: suggestion.supplierName, lines: [], estimatedTotal: 0 };
    group.lines.push(suggestion);
    group.estimatedTotal = round3(group.estimatedTotal + (suggestion.estimatedCost ?? 0));
    groups.set(key, group);
  }
  return [...groups.values()];
}
