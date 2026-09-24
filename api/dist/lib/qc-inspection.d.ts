export declare const DEFAULT_QC_CHECKS: Array<{
    key: string;
    label: string;
}>;
export type QcCheckResult = 'PASS' | 'FAIL' | 'NA';
export type QcTemplateLike = {
    id: string;
    category: string | null;
    active: boolean;
};
export type MemoryQcTemplate = QcTemplateLike & {
    label: string;
    checks: Array<{
        key: string;
        label: string;
    }>;
    createdById: string;
    createdAt: string;
};
export type MemoryQcInspection = {
    id: string;
    templateId: string;
    itemId: string | null;
    lotId: string | null;
    locationId: string | null;
    sourceDocument: string | null;
    sourceLineId: string | null;
    results: Record<string, QcCheckResult>;
    overallResult: 'PASS' | 'FAIL';
    notes: string | null;
    inspectedById: string;
    createdAt: string;
};
export declare function resetMemoryQc(): void;
export declare function listMemoryQcTemplates(): MemoryQcTemplate[];
export declare function listMemoryQcInspections(): MemoryQcInspection[];
export declare function createMemoryQcTemplate(input: {
    label: string;
    category?: string | null;
    checks: Array<{
        key: string;
        label: string;
    }>;
    createdById: string;
    active?: boolean;
}): MemoryQcTemplate;
export declare function patchMemoryQcTemplate(id: string, data: Partial<Pick<MemoryQcTemplate, 'label' | 'category' | 'active' | 'checks'>>): MemoryQcTemplate | null;
export declare function recordMemoryQcInspection(input: RecordQcInspectionInput): MemoryQcInspection;
/** Pure: most specific matching active template - category-scoped beats global, same convention as ToleranceRule/EvidenceRule/ApprovalRule. */
export declare function findTemplateForCategory<T extends QcTemplateLike>(templates: T[], category: string | null): T | null;
/** Pure: a checklist fails overall if any individual check failed; NA checks never fail it. */
export declare function evaluateInspection(results: Record<string, QcCheckResult>): 'PASS' | 'FAIL';
export type RecordQcInspectionInput = {
    templateId?: string | null;
    itemId?: string | null;
    itemCategory?: string | null;
    lotId?: string | null;
    locationId?: string | null;
    branchId?: string | null;
    sourceDocument?: string | null;
    sourceLineId?: string | null;
    results: Record<string, QcCheckResult>;
    notes?: string | null;
    inspectedById: string;
    companyId: string;
};
/**
 * Records a filled-in checklist and, on FAIL, opens the same QC_FAIL
 * exception case the receiving flow already uses for damage - so a QC
 * failure lands in the same Exception Inbox reviewers already work from.
 * Resolves the template explicitly when given, else the most specific
 * active template for the item's category, else a synthesized template
 * from DEFAULT_QC_CHECKS so a checklist is always available even before
 * any admin configures one.
 */
export declare function recordQcInspection(input: RecordQcInspectionInput): Promise<{
    inspection: MemoryQcInspection;
    exceptionCase: any;
} | {
    inspection: {
        exceptionCaseId: string;
        id: string;
        createdAt: Date;
        tenantId: string;
        itemId: string | null;
        lotId: string | null;
        locationId: string | null;
        notes: string | null;
        sourceDocument: string | null;
        sourceLineId: string | null;
        templateId: string;
        results: import("@prisma/client/runtime/client").JsonValue;
        overallResult: string;
        inspectedById: string;
    };
    exceptionCase: {
        companyId: string;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        tenantId: string;
        status: import("@prisma/client").$Enums.ExceptionStatus;
        itemId: string | null;
        lotId: string | null;
        locationId: string | null;
        priority: import("@prisma/client").$Enums.ExceptionPriority;
        type: import("@prisma/client").$Enums.ExceptionType;
        metadata: import("@prisma/client/runtime/client").JsonValue | null;
        branchId: string | null;
        title: string;
        description: string | null;
        dueAt: Date | null;
        closedAt: Date | null;
        quantity: number | null;
        valueAtRisk: number | null;
        sourceDocument: string | null;
        sourceLineId: string | null;
        ownerId: string | null;
        reportedById: string;
        disposition: import("@prisma/client").$Enums.ExceptionDisposition | null;
        resolutionNotes: string | null;
        resolvedAt: Date | null;
    };
}>;
