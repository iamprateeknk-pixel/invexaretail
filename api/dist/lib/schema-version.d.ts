export type SchemaVersionResult = {
    ok: true;
    appliedCount: number;
} | {
    ok: false;
    reason: string;
    missing: string[];
    unfinished: string[];
};
/** Read-only: queries `_prisma_migrations`, never writes to it or anything else. */
export declare function verifySchemaVersion(): Promise<SchemaVersionResult>;
