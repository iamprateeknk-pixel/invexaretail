import { AdminPortalDialog } from './dialogs/AdminPortalDialog';
import { CommandPaletteDialog } from './dialogs/CommandPaletteDialog';
import { CountDialogs } from './dialogs/CountDialogs';
import { InventoryDialogs } from './dialogs/InventoryDialogs';
import { MovementDialogs } from './dialogs/MovementDialogs';

export function WorkspaceDialogs() {
  return (
    <>
      <CountDialogs />
      <CommandPaletteDialog />
      <MovementDialogs />
      <InventoryDialogs />
      <AdminPortalDialog />
    </>
  );
}
