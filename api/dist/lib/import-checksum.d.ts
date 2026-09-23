export declare function computeFileChecksum(content: string | Buffer): string;
/**
 * A duplicate is the same checksum, same type, same tenant. Different
 * tenants uploading byte-identical files (e.g. a shared vendor template)
 * are not duplicates of each other - each company's import history is its
 * own.
 */
export declare function findDuplicateBatch(companyId: string, type: string, fileChecksum: string): Promise<{
    companyId: string;
    id: string;
    tenantId: string;
    status: string;
    type: string;
    fileName: string;
    sourceFormat: string;
    importedById: string;
    importedAt: Date;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    metadata: import("@prisma/client/runtime/client").JsonValue | null;
    branchId: string | null;
    fileHash: string | null;
    sourceDateFrom: Date | null;
    sourceDateTo: Date | null;
    checkpointRowNumber: number;
    commitPolicy: string;
    reversedAt: Date | null;
}>;
