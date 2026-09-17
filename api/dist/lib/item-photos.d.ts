export declare function saveItemPhoto(itemId: string, uploadedBy: string, fileName: string, bytes: Buffer, makePrimary?: boolean): Promise<{
    id: `${string}-${string}-${string}-${string}-${string}`;
    itemId: string;
    fileName: string;
    mimeType: string;
    size: number;
    isPrimary: boolean;
}>;
export declare function listItemPhotos(itemId: string): Promise<unknown>;
export declare function readItemPhoto(itemId: string, id: string): Promise<{
    mimeType: string;
    contents: Uint8Array;
}>;
export declare function deleteItemPhoto(itemId: string, id: string): Promise<void>;
