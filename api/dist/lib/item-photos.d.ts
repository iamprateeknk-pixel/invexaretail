export declare function saveItemPhoto(itemId: string, uploadedBy: string, fileName: string, bytes: Buffer, makePrimary?: boolean): Promise<{
    id: `${string}-${string}-${string}-${string}-${string}`;
    itemId: string;
    fileName: string;
    mimeType: string;
    size: number;
    isPrimary: boolean;
}>;
export declare function listItemPhotos(itemId: string): Promise<{
    size: number;
    id: string;
    createdAt: Date;
    itemId: string;
    fileName: string;
    mimeType: string;
    isPrimary: boolean;
}[]>;
export declare function readItemPhoto(itemId: string, id: string): Promise<{
    contents: Uint8Array<ArrayBuffer>;
    mimeType: string;
}>;
export declare function deleteItemPhoto(itemId: string, id: string): Promise<void>;
