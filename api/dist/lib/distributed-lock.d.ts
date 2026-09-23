/** PostgreSQL advisory locks make timer/worker work safe across replicas. */
export declare function withDistributedLock<T>(name: string, work: () => Promise<T>): Promise<T | null>;
