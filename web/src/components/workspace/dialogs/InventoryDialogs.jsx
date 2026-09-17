import { ItemDetailsDialog } from './ItemDetailsDialog';
import { QuickAddDialog } from './QuickAddDialog';
import { ScannerDialog } from './ScannerDialog';
import { ExportDialog } from './ExportDialog';
import { ImportReversalDialog } from './ImportReversalDialog';
import { OpeningStockImportDialog } from './OpeningStockImportDialog';
import { DailyImportDialog } from './DailyImportDialog';

export function InventoryDialogs() {
  return (
    <>
      <ItemDetailsDialog />
      <QuickAddDialog />
      <ScannerDialog />
      <ExportDialog />
      <ImportReversalDialog />
      <OpeningStockImportDialog />
      <DailyImportDialog />
    </>
  );
}
