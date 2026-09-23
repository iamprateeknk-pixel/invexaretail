export declare class BranchNotFoundError extends Error {
    constructor(id: string);
}
export declare class BranchCodeConflictError extends Error {
    constructor(code: string);
}
export type ArchiveBlockers = {
    activeStock: number;
    openTransfers: number;
    pendingWork: number;
};
export declare class BranchHasActiveWorkError extends Error {
    readonly blockers: ArchiveBlockers;
    constructor(blockers: ArchiveBlockers);
}
export declare function createBranch(input: {
    code: string;
    name: string;
    type?: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    managerId?: string | null;
    workingHours?: string | null;
}): Promise<{
    name: string;
    companyId: string;
    code: string;
    id: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    type: string;
    managerId: string | null;
    workingHours: string | null;
}>;
export declare function updateBranch(id: string, patch: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    managerId?: string;
    workingHours?: string;
    status?: string;
}): Promise<{
    name: string;
    companyId: string;
    code: string;
    id: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    type: string;
    managerId: string | null;
    workingHours: string | null;
}>;
export declare function archiveBranch(id: string): Promise<{
    name: string;
    companyId: string;
    code: string;
    id: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    createdAt: Date;
    updatedAt: Date;
    tenantId: string;
    status: string;
    type: string;
    managerId: string | null;
    workingHours: string | null;
}>;
