export function classifyOfflineAction(path) {
  if (path.includes('qc-inspections')) return 'qc';
  if (path.includes('putaway')) return 'putaway';
  if (path.includes('pick-slips') || path.includes('picker/')) return 'pick';
  if (path.includes('exceptions')) return 'exception';
  if (path.includes('counts')) return 'count';
  if (path.includes('transfers') && path.includes('receive')) return 'receive';
  if (path.includes('transfers')) return 'transfer';
  if (path.includes('assignments')) return 'assignment';
  return 'import';
}
