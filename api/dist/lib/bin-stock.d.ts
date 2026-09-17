export type BinStockKey = {
    itemId: string;
    lotId: string | null;
    locationId: string;
    binId: string;
};
export type BinStockRecord = BinStockKey & {
    onHand: number;
    reserved: number;
    version: number;
};
export declare class BinStockLedger {
    private readonly rows;
    get(key: BinStockKey): BinStockRecord;
    list(filter?: Partial<BinStockKey>): BinStockRecord[];
    onHandInBin(locationId: string, binId: string, itemId?: string): number;
    apply(key: BinStockKey, qtyDelta: number): BinStockRecord;
    move(from: BinStockKey, toBinId: string, quantity: number): {
        from: BinStockRecord;
        to: BinStockRecord;
    };
}
export declare const STAGING_BIN_ID = "__STAGING__";
export declare const memoryBinStock: BinStockLedger;
export type MemoryBin = {
    id: string;
    locationId: string;
    code: string;
    zone: string | null;
    aisle: string | null;
    rack: string | null;
    shelf: string | null;
    capacity: number | null;
    storageClass: string | null;
};
export declare function listMemoryBins(locationId: string): MemoryBin[];
export declare function findMemoryBin(id: string): MemoryBin | undefined;
export declare function createMemoryBin(input: Omit<MemoryBin, 'id'> & {
    id?: string;
}): MemoryBin;
export type BinMoveRecord = {
    id: string;
    itemId: string;
    lotId: string;
    locationId: string;
    fromBinId: string;
    toBinId: string;
    quantity: number;
    reference: string | null;
    actorId: string | null;
    createdAt: Date | string;
};
/**
 * Moves stock from one bin to another and records the move in the
 * BinMovement ledger, transactionally. The caller must have already
 * validated the scans (assertValidBinMove) - this only persists.
 */
export declare function moveBinStockPersisted(input: BinStockKey & {
    toBinId: string;
    quantity: number;
    reference?: string | null;
    actorId?: string | null;
}): Promise<BinMoveRecord>;
export declare function persistBinStockDelta(input: BinStockKey & {
    qtyDelta: number;
}): Promise<void>;
