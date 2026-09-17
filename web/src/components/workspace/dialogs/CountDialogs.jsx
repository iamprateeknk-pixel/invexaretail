import { CountTaskSheet } from './CountTaskSheet';
import { AssignCountDialog } from './AssignCountDialog';
import { ReviewVarianceDialog } from './ReviewVarianceDialog';
import { BulkCountDialog } from './BulkCountDialog';

export function CountDialogs() {
  return (
    <>
      <CountTaskSheet />
      <AssignCountDialog />
      <ReviewVarianceDialog />
      <BulkCountDialog />
    </>
  );
}
