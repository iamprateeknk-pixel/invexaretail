export declare function saveItemPhoto(itemId: string, uploadedBy: string, fileName: string, bytes: Buffer, makePrimary?: boolean): Promise<{
    id: string;
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
    byteSize: number;
    isPrimary: boolean;
}[]>;
export declare function readItemPhoto(itemId: string, id: string): Promise<{
    mimeType: string;
    contents: Uint8Array<ArrayBuffer>;
}>;
export declare function deleteItemPhoto(itemId: string, id: string): Promise<void>;
