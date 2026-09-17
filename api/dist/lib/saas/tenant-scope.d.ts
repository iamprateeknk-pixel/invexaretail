import type { NextFunction, Request, Response } from 'express';
export declare const DEFAULT_COMPANY_ID = "default-company";
export declare const DEFAULT_TENANT_ID = "tenant-invexa";
export declare const PLAN_PRICES: Record<string, number>;
export declare const JAIPUR_COMPANY_ID = "company-jaipur";
export declare const JAIPUR_LOCATION_ID = "loc-jaipur-1";
export declare const JAIPUR_ITEM_ID = "item-jaipur-1";
export declare function seedDefaultTenantOwnership(): void;
export declare function ensureJaipurOperationalWorkspace(): void;
export declare function registerLocationCompany(locationId: string, companyId: string): void;
export declare function registerItemCompany(itemId: string, companyId: string): void;
export declare function adoptHydratedOwnership(input: {
    locations: Array<{
        id: string;
        companyId?: string | null;
    }>;
    items: Array<{
        id: string;
        companyId?: string | null;
    }>;
}): void;
export declare function ownerOfLocation(locationId: string): string | undefined;
export declare function ownerOfItem(itemId: string): string | undefined;
export declare function companyOwnsLocation(companyId: string, locationId: string): boolean;
export declare function companyOwnsItem(companyId: string, itemId: string): boolean;
export declare function locationsForCompany<T extends {
    id: string;
}>(companyId: string, rows: T[]): T[];
export declare function itemsForCompany<T extends {
    id: string;
}>(companyId: string, rows: T[]): T[];
export declare function enforceOperationalCompanyScope(req: Request, res: Response, next: NextFunction): void;
