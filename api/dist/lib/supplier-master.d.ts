export declare const SUPPLIER_STATUSES: readonly ["ACTIVE", "INACTIVE", "BLOCKED"];
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
export type SupplierFields = {
    name?: string;
    email?: string | null;
    phone?: string | null;
    contactName?: string | null;
    leadTimeDays?: number | null;
    moq?: number | null;
    paymentTerms?: string | null;
    categories?: string | null;
    status?: SupplierStatus;
};
/** Only the keys present in the body are returned, so a partial update never clears a field it did not mention. */
export declare function parseSupplierFields(body: Record<string, unknown>, requireName: boolean): SupplierFields;
export declare function categoriesToList(stored: string | null | undefined): string[];
/** A supplier row as the API returns it: categories as a list. */
export declare function presentSupplier<T extends {
    categories?: string | null;
}>(row: T): Omit<T, 'categories'> & {
    categories: string[];
};
export declare function canOrderFrom(status: string | null | undefined): boolean;
