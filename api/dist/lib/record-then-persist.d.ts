export declare function recordThenPersist<T>(apply: () => T, persist: (record: T) => Promise<unknown>, rollback: (record: T) => void): Promise<T>;
