export function interpretImportResponse(status, result = {}) {
  if (status === 409 && result.preview) return { conflict: true, result };
  if (status < 200 || status >= 300) {
    throw new Error(result.message || result.errors?.[0]?.message || 'Import failed.');
  }
  return { conflict: false, result };
}

export function buildLocalImportErrorCsv(errors) {
  const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [['Row', 'Error'], ...(errors ?? []).map((error) => [error.rowNumber || 'General', error.message])]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}

export function mergeImportBatchProgress(preview, live) {
  if (!preview) return live ?? null;
  if (!live) return preview;
  return {
    ...preview,
    batchToken: live.batchToken ?? preview.batchToken,
    status: live.status ?? preview.status,
    totalRows: live.totalRows ?? preview.totalRows,
    validRows: live.validRows ?? preview.validRows,
    invalidRows: live.invalidRows ?? preview.invalidRows,
    duplicateRows: live.duplicateRows ?? preview.duplicateRows,
    errors: Array.isArray(live.errors) ? live.errors : preview.errors,
    sample: live.sample?.length ? live.sample : preview.sample,
  };
}
