import { CountTaskSheet } from './CountTaskSheet';
import { AssignCountDialog } from './AssignCountDialog';
import { ReviewVarianceDialog } from './ReviewVarianceDialog';
import { BulkCountDialog } from './BulkCountDialog';
import { CountAssignmentEditDialog } from './CountAssignmentEditDialog';

export function CountDialogs() {
  return (
    <>
      <CountTaskSheet />
      <AssignCountDialog />
      <ReviewVarianceDialog />
      <BulkCountDialog />
      <CountAssignmentEditDialog />
    </>
  );
}
