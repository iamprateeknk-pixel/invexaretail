import { ItemRecord, StockLedgerRecord } from './repository.js';
import { daysUntilExpiryDate } from './expiry-date.js';

export interface ExpiryItem {
  itemId: string;
  itemName: string;
  lotId: string;
  lotNo: string;
  expiryDate: string;
  daysUntilExpiry: number;
  quantity: number;
  locationId: string;
  status: 'EXPIRED' | 'EXPIRING_SOON' | 'WARNING' | 'SAFE';
}

export interface ExpiryDashboard {
  expiredItems: ExpiryItem[];
  expiringThisMonth: ExpiryItem[];
  expiringNextMonth: ExpiryItem[];
  allExpiringItems: ExpiryItem[];
  summary: {
    totalExpiredQty: number;
    totalExpiringThisMonthQty: number;
    totalExpiringNextMonthQty: number;
    expiredCount: number;
    expiringThisMonthCount: number;
    expiringNextMonthCount: number;
  };
}

export function calculateDaysUntilExpiry(expiryDate: string | null | undefined): number {
  return daysUntilExpiryDate(expiryDate) ?? Infinity;
}

export function getExpiryStatus(daysUntilExpiry: number): 'EXPIRED' | 'EXPIRING_SOON' | 'WARNING' | 'SAFE' {
  if (daysUntilExpiry < 0) return 'EXPIRED';
  if (daysUntilExpiry <= 7) return 'EXPIRING_SOON';
  if (daysUntilExpiry <= 30) return 'WARNING';
  return 'SAFE';
}

export function buildExpiryDashboard(
  items: ItemRecord[],
  stockLedgers: StockLedgerRecord[],
): ExpiryDashboard {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);

  const itemMap = new Map(items.map((item) => [item.id, item]));

  const expiryItems: ExpiryItem[] = [];

  for (const ledger of stockLedgers) {
    const item = itemMap.get(ledger.itemId);
    if (!item) continue;

    for (const lot of item.lots) {
      if (!lot.expiryDate || ledger.onHand === 0) continue;
      if (ledger.lotId !== lot.id) continue; // Match lot with stock ledger entry

      const daysUntilExpiry = calculateDaysUntilExpiry(lot.expiryDate);
      const status = getExpiryStatus(daysUntilExpiry);

      expiryItems.push({
        itemId: ledger.itemId,
        itemName: item.name,
        lotId: lot.id,
        lotNo: lot.lotNo,
        expiryDate: lot.expiryDate,
        daysUntilExpiry,
        quantity: ledger.onHand,
        locationId: ledger.locationId,
        status,
      });
    }
  }

  const expiredItems = expiryItems.filter((item) => item.status === 'EXPIRED');
  const expiringThisMonth = expiryItems.filter((item) => {
    const expiry = new Date(item.expiryDate);
    return item.status !== 'EXPIRED' && expiry >= thisMonthStart && expiry <= thisMonthEnd;
  });

  const expiringNextMonth = expiryItems.filter((item) => {
    const expiry = new Date(item.expiryDate);
    return item.status !== 'EXPIRED' && expiry >= nextMonthStart && expiry <= nextMonthEnd;
  });

  return {
    expiredItems: expiredItems.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    expiringThisMonth: expiringThisMonth.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    expiringNextMonth: expiringNextMonth.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    allExpiringItems: expiryItems
      .filter((item) => item.status !== 'SAFE')
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    summary: {
      totalExpiredQty: expiredItems.reduce((sum, item) => sum + item.quantity, 0),
      totalExpiringThisMonthQty: expiringThisMonth.reduce((sum, item) => sum + item.quantity, 0),
      totalExpiringNextMonthQty: expiringNextMonth.reduce((sum, item) => sum + item.quantity, 0),
      expiredCount: expiredItems.length,
      expiringThisMonthCount: expiringThisMonth.length,
      expiringNextMonthCount: expiringNextMonth.length,
    },
  };
}
