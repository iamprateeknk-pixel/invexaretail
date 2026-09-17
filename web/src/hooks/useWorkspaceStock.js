import { apiRequest } from '../lib/api-client';
import { matchScannedInventory } from '../lib/barcode';
import { parseGs1Barcode } from '../lib/gs1';
import { buildItemLabelDocument } from '../lib/print-labels';
import { useEffect, useRef, useState } from 'react';

export function useWorkspaceStock({
  authToken,
  role,
  locationId,
  locations,
  items,
  stockRows,
  setCountForm,
  setSelectedItem,
  setModalOpen,
  setSubmitLoading,
  showToast,
  loadAppData,
}) {
  const [stockUpdateForm, setStockUpdateForm] = useState({ locationId: 'loc-1', itemId: '', lotNo: '', expiryDate: '', mode: 'SET', quantity: '', reason: '', requestId: crypto.randomUUID?.() ?? `${Date.now()}` });
  const [cameraActive, setCameraActive] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [scanStatus, setScanStatus] = useState('Ready for a SKU, item ID, or lot barcode.');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({ code: '', name: '', category: '', subcategory: '', company: '', unit: '' });
  const scannerVideoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scannerSessionRef = useRef(0);

  useEffect(() => {
    const sessionId = ++scannerSessionRef.current;
    const stopStream = () => {
      scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
      scannerStreamRef.current = null;
    };
    if (!cameraActive) {
      stopStream();
      return stopStream;
    }
    let timer;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (stream) => {
        if (scannerSessionRef.current !== sessionId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        scannerStreamRef.current = stream;
        const video = scannerVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (!('BarcodeDetector' in window)) {
          setScanStatus('Live decoding is not supported by this browser. Use a USB scanner or type the code below.');
          return;
        }
        const detector = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'] });
        const detect = async () => {
          if (scannerSessionRef.current !== sessionId || video.readyState < 2) return;
          try {
            const matches = await detector.detect(video);
            if (matches[0]?.rawValue) {
              setScanValue(matches[0].rawValue);
              resolveScannedCode(matches[0].rawValue);
              setCameraActive(false);
              return;
            }
          } catch {
            // A moving frame can fail detection; the next frame retries safely.
          }
          timer = window.setTimeout(detect, 350);
        };
        detect();
      })
      .catch((error) => {
        setCameraActive(false);
        setScanStatus('Camera unavailable. Connect a scanner or enter the code manually.');
        showToast(`Camera access unavailable: ${error.message}`, 'error');
      });
    return () => {
      window.clearTimeout(timer);
      stopStream();
    };
  }, [cameraActive, showToast]);

  function openScanner() {
    setScanValue('');
    setScanStatus('Ready for a SKU, item ID, or lot barcode.');
    setModalOpen('scanner');
  }

  function resolveScannedCode(rawCode) {
    // Blueprint P3 "Embedded barcode": one GS1 scan can carry item (GTIN),
    // lot, expiry, serial and quantity together. Parse it first; if it's
    // GS1 data, look the item up by GTIN/lot and carry the rest along.
    // Anything else (a plain SKU/lot barcode) falls through unchanged.
    const gs1 = parseGs1Barcode(rawCode);
    const lookupCode = gs1?.gtin ?? gs1?.batchOrLot ?? rawCode;
    const { code, matches } = matchScannedInventory(items, lookupCode);
    if (!code) {
      setScanStatus('Enter or scan a code first.');
      return;
    }
    if (matches.length === 0) {
      setScanStatus(`No item or lot found for ${code}. Use "Add as new item" below to create it.`);
      showToast(`Barcode ${code} was not found.`, 'error');
      return;
    }
    if (matches.length > 1) {
      setScanStatus(`${matches.length} records use ${code}. Search the inventory and resolve the duplicate before continuing.`);
      showToast('Duplicate barcode detected.', 'error');
      return;
    }
    const { item, matchedLot } = matches[0];
    const gs1Lot = gs1?.batchOrLot ? item.lots?.find((lot) => lot.lotNo.toUpperCase() === gs1.batchOrLot.toUpperCase()) : null;
    const resolvedLot = matchedLot ?? gs1Lot;
    const row = stockRows.find((entry) => entry.itemId === item.id && entry.locationId === locationId);
    setCountForm((current) => ({
      ...current,
      itemId: item.id,
      lotNo: resolvedLot?.lotNo ?? gs1?.batchOrLot ?? item.lots?.[0]?.lotNo ?? '',
      ...(gs1?.quantity !== undefined ? { physicalQuantity: gs1.quantity } : {}),
    }));
    setSelectedItem({
      ...row,
      itemId: item.id,
      itemName: item.name,
      physicalQuantity: row?.physicalQuantity ?? row?.onHand ?? 0,
      lots: item.lots ?? [],
    });
    const gs1Notes = [
      gs1?.expiryDate ? `expiry ${gs1.expiryDate}` : null,
      gs1?.serial ? `serial ${gs1.serial}` : null,
      gs1?.quantity !== undefined ? `qty ${gs1.quantity}` : null,
    ].filter(Boolean);
    setScanStatus(`${item.name} resolved${resolvedLot ? ` · lot ${resolvedLot.lotNo}` : ''}${gs1Notes.length ? ` · ${gs1Notes.join(' · ')} (from GS1 barcode)` : ''}.`);
    setModalOpen('itemDetails');
    showToast(`${item.name} opened from scan.`, 'success');
  }

  function openQuickAdd(prefillCode = '') {
    setQuickAddForm({ code: prefillCode.toUpperCase(), name: '', category: '', subcategory: '', company: '', unit: '' });
    setModalOpen('quickAdd');
  }

  async function createQuickItem() {
    if (!quickAddForm.code.trim() || !quickAddForm.name.trim()) {
      showToast('Item code and name are required.', 'error');
      return;
    }
    setSubmitLoading(true);
    try {
      const response = await apiRequest('/api/v1/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          code: quickAddForm.code.trim(),
          name: quickAddForm.name.trim(),
          category: quickAddForm.category.trim() || undefined,
          subcategory: quickAddForm.subcategory.trim() || undefined,
          company: quickAddForm.company.trim() || undefined,
          unit: quickAddForm.unit.trim() || undefined,
        }),
      });
      setModalOpen(null);
      setScanValue('');
      setScanStatus('Ready for a SKU, item ID, or lot barcode.');
      showToast(`${response.item.name} added.`, 'success');
      await loadAppData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to add item.', 'error');
    } finally {
      setSubmitLoading(false);
    }
  }

  function printItemLabel(item, lot = null) {
    const source = items.find((entry) => entry.id === item.itemId) ?? item;
    const locationName = locations.find((location) => location.id === locationId)?.name ?? 'All locations';
    const { html } = buildItemLabelDocument({ source, item, lot, locationName });
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Allow pop-ups to print labels.', 'error');
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  async function submitManualStockUpdate() {
    try {
      setSubmitLoading(true);
      const response = await apiRequest('/api/v1/stock-adjustments/manual', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ ...stockUpdateForm, quantity: Number(stockUpdateForm.quantity) }),
      });
      showToast(response.message, 'success');
      setStockUpdateForm((current) => ({ ...current, quantity: '', reason: '', requestId: crypto.randomUUID?.() ?? `${Date.now()}` }));
      await loadAppData(authToken, role);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to update stock.', 'error'); }
    finally { setSubmitLoading(false); }
  }

  return {
    stockUpdateForm,
    setStockUpdateForm,
    cameraActive,
    setCameraActive,
    scanValue,
    setScanValue,
    scanStatus,
    scannerVideoRef,
    openScanner,
    resolveScannedCode,
    quickAddOpen,
    setQuickAddOpen,
    quickAddForm,
    setQuickAddForm,
    openQuickAdd,
    createQuickItem,
    printItemLabel,
    submitManualStockUpdate,
  };
}
