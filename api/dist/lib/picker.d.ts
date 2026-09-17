export type PickerTaskInput = {
    transferId: string;
    locationId: string;
    lines: Array<{
        itemId: string;
        lotId: string;
        quantity: number;
    }>;
    assignedPickerId: string;
    role: 'WAREHOUSE_PICKER';
};
export type PickerTask = {
    transferId: string;
    locationId: string;
    lines: Array<{
        itemId: string;
        lotId: string;
        quantity: number;
    }>;
    assignedPickerId: string;
    role: 'WAREHOUSE_PICKER';
    status: 'ASSIGNED';
};
export type PickerCompletionInput = {
    transferId: string;
    pickerId: string;
    role: 'WAREHOUSE_PICKER';
    pickedQty: number;
};
export type PickerCompletion = {
    transferId: string;
    pickerId: string;
    role: 'WAREHOUSE_PICKER';
    status: 'PICKED';
    pickedQty: number;
};
export declare function buildPickerTask(input: PickerTaskInput): PickerTask;
export declare function completePickerTask(input: PickerCompletionInput): PickerCompletion;
