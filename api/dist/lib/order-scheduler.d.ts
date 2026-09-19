export type OrderSweepDeps = {
    expire: () => Promise<number>;
    retry: () => Promise<number>;
    announce: () => void;
};
/** One pass: expire first (frees stock), then retry backorders against what was freed and what arrived. */
export declare function orderSweepTick(deps?: OrderSweepDeps): Promise<{
    expired: number;
    filled: number;
} | null>;
export declare function startOrderScheduler(): () => void;
