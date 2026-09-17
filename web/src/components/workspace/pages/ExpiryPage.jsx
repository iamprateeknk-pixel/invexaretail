import ExpiryBoard from '../../expiry/ExpiryBoard';
import { useWorkspace } from '../WorkspaceContext';

export function ExpiryPage() {
  const {
        expiryBoard, currentLocationName, role, submitLoading, writeOffExpiryLot, setLotExpiryDate,
    setExpiryLotStatus, startExpiryTransfer,
  } = useWorkspace();
  return (
    <ExpiryBoard
      lots={expiryBoard.lots}
      summary={expiryBoard.summary}
      categories={expiryBoard.categories}
      locationName={currentLocationName}
      role={role}
      loading={submitLoading}
      onWriteOff={writeOffExpiryLot}
      onSetExpiry={setLotExpiryDate}
      onSetLotStatus={setExpiryLotStatus}
      onStartTransfer={startExpiryTransfer}
    />
  );
}
