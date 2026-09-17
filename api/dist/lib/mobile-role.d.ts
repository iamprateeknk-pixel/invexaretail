export type MobileDestination = {
    id: string;
    label: string;
    icon: string;
};
export type MobileRoleHome = {
    title: string;
    subtitle: string;
    defaultDestination: string;
    destinations: MobileDestination[];
};
export declare function mobileHomeForRole(role: string): MobileRoleHome;
export declare const OFFLINE_ACTION_TYPES: readonly ["COUNT", "TRANSFER_REQUEST", "TRANSFER_RECEIVE", "PICK", "PUTAWAY", "EXCEPTION", "QC_INSPECTION"];
export type OfflineActionType = (typeof OFFLINE_ACTION_TYPES)[number];
export type OfflineActionSpec = {
    type: OfflineActionType;
    method: 'POST' | 'PATCH';
    endpoint: string;
};
export declare function offlineActionSpec(type: OfflineActionType): OfflineActionSpec;
