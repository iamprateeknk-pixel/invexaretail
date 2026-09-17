import { listItems, type LocationRecord } from '../lib/repository.js';
import { type StockImportPreview } from '../lib/stock-import.js';
declare const router: import("express-serve-static-core").Router;
type StockUpdateMode = 'SET' | 'ADD' | 'REMOVE';
export declare function planStockUpdate(preview: StockImportPreview, mode: StockUpdateMode): {
    errors: import("../lib/stock-import.js").StockImportError[];
    prepared: {
        row: StockImportPreview["validRows"][number];
        item: ReturnType<typeof listItems>[number];
        location: LocationRecord;
        lotId: string;
        lotNo: string;
        expiryDate?: string | null;
        isNewLot: boolean;
        isNewItem: boolean;
        isNewLocation: boolean;
        currentQty: number;
        qtyDelta: number;
        resultingQty: number;
    }[];
    newItems: number;
    newLocations: number;
};
export default router;
