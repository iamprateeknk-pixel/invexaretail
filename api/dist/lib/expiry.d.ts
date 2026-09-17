import { ItemRecord, StockLedgerRecord } from './repository.js';
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
export declare function calculateDaysUntilExpiry(expiryDate: string | null | undefined): number;
export declare function getExpiryStatus(daysUntilExpiry: number): 'EXPIRED' | 'EXPIRING_SOON' | 'WARNING' | 'SAFE';
export declare function buildExpiryDashboard(items: ItemRecord[], stockLedgers: StockLedgerRecord[]): ExpiryDashboard;
