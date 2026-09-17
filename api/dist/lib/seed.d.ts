import type { CountRecord, ItemRecord, LocationRecord, StockLedgerRecord, TransferRecord } from './repository.js';
export type SeedUser = {
    id: string;
    email: string;
    name: string;
    role: 'ADMIN' | 'ADMIN_USER' | 'BRANCH_MANAGER' | 'STORE_USER' | 'WAREHOUSE_PICKER' | 'AUDITOR';
    assignedLocationIds: string[];
};
export declare const seedUsers: SeedUser[];
export declare const seedLocations: LocationRecord[];
export declare const seedItems: ItemRecord[];
export declare const seedStockLedger: StockLedgerRecord[];
export type SeedReorderRule = {
    id: string;
    itemId: string;
    locationId: string;
    minQty: number;
    targetQty: number;
};
export declare const seedReorderRules: SeedReorderRule[];
export declare const seedCounts: CountRecord[];
export declare const seedTransfers: TransferRecord[];
