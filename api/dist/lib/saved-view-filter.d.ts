export type SavedViewFilterConfig = {
    tagIds?: string[];
    category?: string | null;
    subcategory?: string | null;
    search?: string | null;
};
export type SavedViewFilterableItem = {
    id: string;
    name: string;
    code: string;
    category?: string | null;
    subcategory?: string | null;
    tagIds: string[];
};
export declare function matchesSavedViewFilter(item: SavedViewFilterableItem, filter: SavedViewFilterConfig): boolean;
export declare function applySavedViewFilter<T extends SavedViewFilterableItem>(items: T[], filter: SavedViewFilterConfig): T[];
