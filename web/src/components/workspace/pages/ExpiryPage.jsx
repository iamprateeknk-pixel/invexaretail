import ExpiryBoard from '../../expiry/ExpiryBoard';
import { useItemFieldValues, usesItemFields } from '../../../hooks/useItemFieldValues';
import { lotTableColumns } from '../../../lib/lots-table';
import { useWorkspace } from '../WorkspaceContext';

export function ExpiryPage() {
  const {
        expiryBoard, currentLocationName, role, submitLoading, writeOffExpiryLot, setLotExpiryDate,
    setExpiryLotStatus, startExpiryTransfer, runtimeConfig, authToken,
  } = useWorkspace();
  const columns = lotTableColumns(runtimeConfig?.page, { role });
  const itemFieldValues = useItemFieldValues({ authToken, enabled: usesItemFields(columns) });
  return (
    <ExpiryBoard
      lots={expiryBoard.lots}
      summary={expiryBoard.summary}
      categories={expiryBoard.categories}
      locationName={currentLocationName}
      role={role}
      loading={submitLoading}
      columns={columns}
      itemFieldValues={itemFieldValues}
      onWriteOff={writeOffExpiryLot}
      onSetExpiry={setLotExpiryDate}
      onSetLotStatus={setExpiryLotStatus}
      onStartTransfer={startExpiryTransfer}
    />
  );
}
