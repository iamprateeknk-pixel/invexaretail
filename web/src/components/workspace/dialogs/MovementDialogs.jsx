import { TransferRequestDialog } from './TransferRequestDialog';
import { ReceivePurchaseOrderDialog } from './ReceivePurchaseOrderDialog';
import { ReceiveTransferDialog } from './ReceiveTransferDialog';
import { TransferImportDialog } from './TransferImportDialog';
import { PickerDetailDialog } from './PickerDetailDialog';

export function MovementDialogs() {
  return (
    <>
      <TransferRequestDialog />
      <ReceivePurchaseOrderDialog />
      <ReceiveTransferDialog />
      <TransferImportDialog />
      <PickerDetailDialog />
    </>
  );
}
