export declare const INDUSTRY_KEYS: readonly ["grocery"];
export type IndustryKey = (typeof INDUSTRY_KEYS)[number];
export type AllocationStrategy = 'FEFO' | 'FIFO';
export type DashboardKpiKey = 'pending_counts' | 'transfers' | 'low_stock' | 'expiry_risk' | 'discrepancy' | 'pending_approvals' | 'assets' | 'jobs';
export type IndustryCustomFieldSeed = {
    name: string;
    type: 'text' | 'number' | 'date' | 'boolean' | 'select';
    options?: string[];
    required?: boolean;
};
export type IndustryPack = {
    key: IndustryKey;
    label: string;
    description: string;
    hide: string[];
    dashboardKpis: DashboardKpiKey[];
    allocationStrategy: AllocationStrategy;
    expiryBlocking: boolean;
    tags: Array<{
        name: string;
        color: string;
    }>;
    customFields: IndustryCustomFieldSeed[];
    categories: string[];
    units: string[];
    variantFields?: string[];
    serialFieldNames?: string[];
};
export type WorkspacePackView = {
    key: IndustryKey;
    label: string;
    description: string;
    hide: string[];
    dashboardKpis: DashboardKpiKey[];
    allocationStrategy: AllocationStrategy;
    expiryBlocking: boolean;
    modules: Record<string, boolean>;
    categories: string[];
    units: string[];
    variantFields: string[];
    serialFieldNames: string[];
};
export declare const INDUSTRY_PACKS: Record<IndustryKey, IndustryPack>;
export type ActiveWorkflow = {
    allocationStrategy: AllocationStrategy;
    expiryBlocking: boolean;
    fefoEnforced: boolean;
    industryKey: IndustryKey;
};
export declare function listIndustryCatalog(): IndustryPack[];
export declare function isIndustryKey(value: unknown): value is IndustryKey;
export declare function resolveIndustryKey(_value?: string | null): IndustryKey;
export declare function getIndustryPack(key?: string | null): IndustryPack;
export declare function toWorkspacePackView(pack: IndustryPack): WorkspacePackView;
export declare function getActiveWorkflow(): ActiveWorkflow;
export declare function setActiveWorkflow(update: ActiveWorkflow): ActiveWorkflow;
export declare function workflowFromPack(pack: IndustryPack): ActiveWorkflow;
export declare function missingPackSeeds<T extends {
    name: string;
}>(existingNames: Iterable<string>, seeds: T[]): T[];
export declare function isSerialFieldName(fieldName: string, pack?: IndustryPack): boolean;
export declare function applyIndustryPack(industryKey: IndustryKey): Promise<{
    createdTags: number;
    createdFields: number;
}>;
export declare function hydrateActiveWorkflow(industryKey?: string | null): Promise<ActiveWorkflow>;
