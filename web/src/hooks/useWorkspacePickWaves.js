import { apiRequest } from '../lib/api-client';
import { useEffect, useState } from 'react';

// Blueprint Module C / section 9.2: pick waves group several
// source-location transfers into one bin-sequenced pick pass.
export function useWorkspacePickWaves({
  authToken,
  activeSection,
  locationId,
  setSubmitLoading,
  showToast,
}) {
  const [pickWaves, setPickWaves] = useState([]);
  const [waveDetail, setWaveDetail] = useState(null);
  const [selectedTransferIds, setSelectedTransferIds] = useState([]);

  function loadPickWaves() {
    if (!authToken) return;
    apiRequest(`/api/v1/pick-waves?locationId=${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((response) => setPickWaves(response.waves ?? []))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!authToken || activeSection !== 'picking') return;
    loadPickWaves();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, authToken, locationId]);

  function toggleTransferSelection(transferId) {
    setSelectedTransferIds((current) => current.includes(transferId) ? current.filter((id) => id !== transferId) : [...current, transferId]);
  }

  async function createPickWave(waveLocationId) {
    if (selectedTransferIds.length < 2) return;
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/pick-waves', {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ locationId: waveLocationId || locationId, transferIds: selectedTransferIds }),
      });
      setPickWaves((current) => [response.wave, ...current]);
      setSelectedTransferIds([]);
      showToast(`Pick wave created with ${selectedTransferIds.length} transfers.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create pick wave.', 'error');
    } finally { setSubmitLoading(false); }
  }

  async function openPickWave(waveId) {
    try {
      const response = await apiRequest(`/api/v1/pick-waves/${waveId}`, { headers: { Authorization: `Bearer ${authToken}` } });
      setWaveDetail(response);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to load pick wave.', 'error');
    }
  }

  async function updatePickWaveStatus(waveId, status) {
    try {
      const response = await apiRequest(`/api/v1/pick-waves/${waveId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${authToken}` }, body: JSON.stringify({ status }),
      });
      setPickWaves((current) => current.map((wave) => wave.id === waveId ? response.wave : wave));
      if (status === 'COMPLETED' || status === 'CANCELLED') setWaveDetail(null);
      showToast(`Pick wave moved to ${status}.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update pick wave.', 'error');
    }
  }

  return {
    pickWaves, waveDetail, setWaveDetail, selectedTransferIds, toggleTransferSelection,
    createPickWave, openPickWave, updatePickWaveStatus,
  };
}
