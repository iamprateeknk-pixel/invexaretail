export declare function evidenceMime(bytes: Buffer): string;
export declare function saveTransferEvidence(transferId: string, uploadedBy: string, fileName: string, bytes: Buffer): Promise<{
    id: `${string}-${string}-${string}-${string}-${string}`;
    transferId: string;
    fileName: string;
    mimeType: string;
    size: number;
}>;
export declare function listTransferEvidence(transferId: string): Promise<unknown>;
export declare function readTransferEvidence(transferId: string, id: string): Promise<{
    mimeType: string;
    contents: Uint8Array;
}>;
