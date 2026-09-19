/** MySQL advisory locks make timer/worker work safe when Render runs more than one replica. */
export declare function withDistributedLock<T>(name: string, work: () => Promise<T>): Promise<T | null>;
