import { TransferRecord } from './repository.js';
export interface ThermalPDFOptions {
    transfer: TransferRecord;
    itemNames: Map<string, string>;
    locationNames: Map<string, string>;
    printedBy: string;
    printTime: string;
}
export declare function generateThermalTransferLabel(options: ThermalPDFOptions): string;
export interface ReportEntry {
    printTime: string;
    transferId: string;
    printedBy: string;
    printCount: number;
    notes?: string;
}
export declare const reprintAuditLog: ReportEntry[];
export declare function recordReprint(entry: Omit<ReportEntry, 'printCount'>): void;
export declare function getReprintAudit(transferId?: string): ReportEntry[];
