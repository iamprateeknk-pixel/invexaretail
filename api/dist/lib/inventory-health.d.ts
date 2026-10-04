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
/** revenue is null when the item has no resolvable selling price (PriceList) - never guessed, same as unitCost. */
export type HealthSales = {
    units: number;
    cogs: number;
    revenue?: number | null;
};
/** NO_DATA: no sales movements exist at all for the window, so we cannot tell dead from unrecorded - we say so instead of calling everything dead. */
export type ItemHealthStatus = 'DEAD' | 'SLOW' | 'HEALTHY' | 'NO_STOCK' | 'NO_DATA';
export type InventoryHealth = {
    windowDays: number;
    valuation: {
        totalValue: number;
        valuedUnits: number;
        /** Units whose lot has no cost: they are NOT in totalValue (we do not guess a price). */
        unvaluedUnits: number;
        byCategory: Array<{
            category: string;
            value: number;
            units: number;
        }>;
    };
    /** Annualised: (cost of goods sold in the window x 365/window) / current inventory value. Null with no value or no sales. */
    turns: number | null;
    daysOfInventory: number | null;
    /**
     * Gross Margin Return on Investment (audit O-5), same annualised-over-current-value shape as
     * turns: (priced revenue - cost of goods sold on that same priced revenue, x 365/window) /
     * current inventory value. Only sales whose item has a resolvable PriceList price count -
     * never a guessed margin. Null when there is no value, or nothing sold was priced.
     */
    gmroi: number | null;
    /** Units sold in the window whose item had no resolvable price, so they could not count toward gmroi. */
    unitsSoldUnpriced: number;
    ageing: Array<{
        bucket: '0-30' | '31-90' | '91-180' | '181+';
        value: number;
        units: number;
    }>;
    items: Array<{
        itemId: string;
        code: string;
        name: string;
        onHand: number;
        value: number;
        unitsSold: number;
        avgDailyDemand: number;
        daysOfCover: number | null;
        status: ItemHealthStatus;
    }>;
    deadStock: {
        items: number;
        value: number;
        units: number;
    };
    slowStock: {
        items: number;
        value: number;
        units: number;
    };
};
/** More than this many days of cover at the current sales rate is slow-moving stock. */
export declare const SLOW_COVER_DAYS = 180;
export declare function buildInventoryHealth(input: {
    rows: HealthStockRow[];
    sales: Map<string, HealthSales>;
    windowDays: number;
    hasSalesData?: boolean;
    now?: Date;
}): InventoryHealth;
/** Unit cost from lot attributes: landed cost first, then the purchase rate; null when neither is recorded. */
export declare function lotUnitCost(attributes: Record<string, unknown> | null | undefined): number | null;
/**
 * Service level from orders (audit O-5). Only orders that reached an outcome count: FULFILLED is a
 * success; BACKORDERED (still waiting) and EXPIRED (reservation lapsed unfulfilled) are the stock
 * failing the customer. Open RESERVED orders and CANCELLED ones say nothing about availability.
 * Line fill rate weighs quantity: units fulfilled over units requested on those orders.
 */
export declare function summarizeServiceLevel(orders: Array<{
    status: string;
    lines: Array<{
        requestedQty: number;
        fulfilledQty: number;
    }>;
}>): {
    orders: number;
    fulfilledOrders: number;
    backorderedOrders: number;
    expiredOrders: number;
    orderFillRatePercent: number;
    unitFillRatePercent: number;
};
