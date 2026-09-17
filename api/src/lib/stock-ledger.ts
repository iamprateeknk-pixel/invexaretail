// Stock Accounting Engine (blueprint section 6): stock quantity is never an
// unexplained editable number. Every quantity change is posted as an
// immutable StockMovement; balances are a derived projection of those
// movements, keyed by item + lot + location + bin. Location ATP still sums
// every bin; "how much is in Bin A" is the bin-qualified key.

export type StockMovementType =
  | 'OPENING_STOCK'
  | 'PURCHASE_RECEIPT'
  | 'SALES_DEDUCTION'
  | 'SALES_RETURN'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'COUNT_VARIANCE'
  | 'ADJUSTMENT'
  | 'WASTE'
  | 'DAMAGE'
  | 'EXPIRY_WRITE_OFF';

export type NegativeStockPolicy = 'BLOCK' | 'WARN' | 'ALLOW';

export type StockMovementRecord = {
  id: string;
  itemId: string;
  lotId: string | null;
  locationId: string;
  binId?: string | null;
  movementType: StockMovementType;
  qtyDelta: number;
  beforeBalance: number;
  afterBalance: number;
  sourceDocument?: string;
  sourceLineId?: string;
  actor: string;
  timestamp: string;
  correlationId: string;
  reason?: string;
  reversalOfId?: string;
  reversedById?: string;
  metadata?: Record<string, unknown>;
};

export type StockBalanceKey = { itemId: string; lotId: string | null; locationId: string; binId?: string | null };

export type StockBalanceRecord = StockBalanceKey & {
  onHand: number;
  reserved: number;
  inTransit: number;
  available: number;
  version: number;
};

export type PostMovementInput = {
  itemId: string;
  lotId?: string | null;
  locationId: string;
  binId?: string | null;
  movementType: StockMovementType;
  qtyDelta: number;
  actor: string;
  sourceDocument?: string;
  sourceLineId?: string;
  correlationId?: string;
  reason?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  negativeStockPolicy?: NegativeStockPolicy;
};

export class NegativeStockBlockedError extends Error {
  constructor(public readonly key: StockBalanceKey, public readonly attemptedBalance: number) {
    super(
      `Movement blocked: posting would take stock to ${attemptedBalance} for item ${key.itemId} ` +
        `lot ${key.lotId ?? 'none'} at location ${key.locationId}.`,
    );
    this.name = 'NegativeStockBlockedError';
  }
}

export const UNASSIGNED_BIN_ID = 'UNASSIGNED';

function balanceKey(key: StockBalanceKey): string {
  return `${key.itemId}::${key.lotId ?? 'NOLOT'}::${key.locationId}::${key.binId ?? UNASSIGNED_BIN_ID}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * In-memory projection of the stock ledger. Mirrors the StockMovement /
 * StockBalance Prisma models so the same posting rules can run in tests and
 * in-memory dev mode before being backed by the database in production.
 */
export class StockLedger {
  private readonly movements: StockMovementRecord[] = [];
  private readonly balances = new Map<string, StockBalanceRecord>();

  getBalance(key: StockBalanceKey): StockBalanceRecord {
    const existing = this.balances.get(balanceKey(key));
    if (existing) return { ...existing };
    return { ...key, onHand: 0, reserved: 0, inTransit: 0, available: 0, version: 0 };
  }

  listMovements(filter?: Partial<StockBalanceKey>): StockMovementRecord[] {
    return this.movements
      .filter((m) => {
        if (filter?.itemId && m.itemId !== filter.itemId) return false;
        if (filter?.locationId && m.locationId !== filter.locationId) return false;
        if (filter?.lotId !== undefined && m.lotId !== filter.lotId) return false;
        if (filter?.binId !== undefined && (m.binId ?? UNASSIGNED_BIN_ID) !== (filter.binId ?? UNASSIGNED_BIN_ID)) return false;
        return true;
      })
      .map((m) => ({ ...m }));
  }

  /**
   * Posts one movement transactionally against the current balance. Posted
   * movements are never mutated afterwards — corrections must call
   * reverseMovement() and post a new, corrected movement instead.
   */
  postMovement(input: PostMovementInput): StockMovementRecord {
    const key: StockBalanceKey = {
      itemId: input.itemId,
      lotId: input.lotId ?? null,
      locationId: input.locationId,
      binId: input.binId ?? UNASSIGNED_BIN_ID,
    };
    const current = this.getBalance(key);
    const afterBalance = current.onHand + input.qtyDelta;
    const policy = input.negativeStockPolicy ?? 'BLOCK';

    if (afterBalance < 0) {
      if (policy === 'BLOCK') {
        throw new NegativeStockBlockedError(key, afterBalance);
      }
      if (policy === 'WARN') {
        // eslint-disable-next-line no-console
        console.warn(`Negative stock warning: ${JSON.stringify(key)} -> ${afterBalance}`);
      }
      // ALLOW falls through silently.
    }

    const movement: StockMovementRecord = {
      id: makeId('mv'),
      itemId: input.itemId,
      lotId: input.lotId ?? null,
      locationId: input.locationId,
      binId: key.binId ?? UNASSIGNED_BIN_ID,
      movementType: input.movementType,
      qtyDelta: input.qtyDelta,
      beforeBalance: current.onHand,
      afterBalance,
      sourceDocument: input.sourceDocument,
      sourceLineId: input.sourceLineId,
      actor: input.actor,
      timestamp: input.timestamp ?? new Date().toISOString(),
      correlationId: input.correlationId ?? makeId('corr'),
      reason: input.reason,
      metadata: input.metadata,
    };

    this.movements.push(movement);
    this.balances.set(balanceKey(key), {
      ...key,
      onHand: afterBalance,
      reserved: current.reserved,
      inTransit: current.inTransit,
      available: afterBalance - current.reserved,
      version: current.version + 1,
    });

    return { ...movement };
  }

  /**
   * Reverses a posted movement by posting an equal-and-opposite movement
   * linked back to the original. The original record is left untouched.
   */
  reverseMovement(movementId: string, actor: string, reason: string): StockMovementRecord {
    const original = this.movements.find((m) => m.id === movementId);
    if (!original) {
      throw new Error(`Cannot reverse unknown movement ${movementId}`);
    }
    if (original.reversedById) {
      throw new Error(`Movement ${movementId} was already reversed by ${original.reversedById}`);
    }

    const reversal = this.postMovement({
      itemId: original.itemId,
      lotId: original.lotId,
      locationId: original.locationId,
      binId: original.binId,
      movementType: original.movementType,
      qtyDelta: -original.qtyDelta,
      actor,
      sourceDocument: original.sourceDocument,
      sourceLineId: original.sourceLineId,
      correlationId: original.correlationId,
      reason,
      negativeStockPolicy: 'ALLOW',
      metadata: { ...original.metadata, reversalOf: original.id },
    });

    const reversalWithLink: StockMovementRecord = { ...reversal, reversalOfId: original.id };
    const idx = this.movements.findIndex((m) => m.id === reversal.id);
    this.movements[idx] = reversalWithLink;

    const originalIdx = this.movements.findIndex((m) => m.id === original.id);
    this.movements[originalIdx] = { ...original, reversedById: reversal.id };

    return { ...reversalWithLink };
  }

  /** Reserves quantity ahead of a transfer/pick allocation without moving on-hand stock. */
  reserve(key: StockBalanceKey, qty: number): StockBalanceRecord {
    const current = this.getBalance(key);
    if (current.available < qty) {
      throw new Error(
        `Cannot reserve ${qty}: only ${current.available} available for ${JSON.stringify(key)}`,
      );
    }
    const updated: StockBalanceRecord = {
      ...current,
      reserved: current.reserved + qty,
      available: current.available - qty,
      version: current.version + 1,
    };
    this.balances.set(balanceKey(key), updated);
    return { ...updated };
  }

  releaseReservation(key: StockBalanceKey, qty: number): StockBalanceRecord {
    const current = this.getBalance(key);
    const releaseQty = Math.min(qty, current.reserved);
    const updated: StockBalanceRecord = {
      ...current,
      reserved: current.reserved - releaseQty,
      available: current.available + releaseQty,
      version: current.version + 1,
    };
    this.balances.set(balanceKey(key), updated);
    return { ...updated };
  }

  /** sum(posted movements) recomputed from scratch, for reconciliation checks against getBalance(). */
  recomputeBalanceFromMovements(key: StockBalanceKey): number {
    return this.movements
      .filter((m) => m.itemId === key.itemId && m.lotId === key.lotId && m.locationId === key.locationId && (m.binId ?? UNASSIGNED_BIN_ID) === (key.binId ?? UNASSIGNED_BIN_ID))
      .reduce((sum, m) => sum + m.qtyDelta, 0);
  }

  /** Location-level on-hand: sum of every bin for this item/lot/location. */
  getLocationOnHand(itemId: string, lotId: string | null, locationId: string): number {
    return [...this.listMovements({ itemId, lotId, locationId })].reduce((sum, movement) => sum + movement.qtyDelta, 0);
  }
}
