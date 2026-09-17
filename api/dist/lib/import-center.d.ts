export type ImportBatchStatus = 'DRAFT' | 'PREVIEWED' | 'VALIDATED' | 'POSTED' | 'REVERSED' | 'FAILED';
export declare class InvalidBatchTransitionError extends Error {
    readonly from: ImportBatchStatus;
    readonly to: ImportBatchStatus;
    constructor(from: ImportBatchStatus, to: ImportBatchStatus);
}
export declare function assertValidBatchTransition(from: ImportBatchStatus, to: ImportBatchStatus): void;
export type BatchFingerprint = {
    sourceType: string;
    branchCode: string;
    fileHash: string;
    sourceDateFrom: string;
    sourceDateTo: string;
};
export declare function computeFileHash(buffer: Buffer): string;
export declare class DuplicateImportBatchError extends Error {
    readonly existingBatchId: string;
    constructor(existingBatchId: string);
}
/**
 * Tracks one fingerprint per accepted batch so the same file (same branch,
 * same source date range) cannot be re-imported as a fresh batch, and a
 * batch cannot be posted a second time under a new id.
 */
export declare class ImportDuplicateGuard {
    private readonly seen;
    /** Throws DuplicateImportBatchError if this exact file/branch/date range was already registered. */
    register(fingerprint: BatchFingerprint, batchId: string): void;
    findExisting(fingerprint: BatchFingerprint): string | undefined;
}
export type ImportTemplate = {
    id: string;
    name: string;
    importType: string;
    /** field name -> the exact header text this template expects for that field */
    columnMapping: Record<string, string>;
};
export declare class ImportTemplateRegistry {
    private readonly templates;
    save(template: ImportTemplate): void;
    list(importType?: string): ImportTemplate[];
    get(id: string): ImportTemplate | undefined;
    /**
     * Scores every template of this import type against the file's actual
     * header row and returns the best match (and its match ratio), so the
     * Import Center can offer "we recognize this as your Logic ERP Sales
     * template" instead of asking for manual mapping every time.
     */
    findBestMatch(headers: string[], importType: string): {
        template: ImportTemplate;
        confidence: number;
    } | undefined;
}
export type ImportRowError = {
    rowNumber: number;
    message: string;
};
export type ImportErrorReportEntry = {
    rowNumber: number;
    reason: string;
    suggestedFix: string;
};
export declare function suggestFixFor(message: string): string;
export declare function buildImportErrorReport(errors: ImportRowError[]): ImportErrorReportEntry[];
export declare function errorReportToCsv(entries: ImportErrorReportEntry[]): string;
