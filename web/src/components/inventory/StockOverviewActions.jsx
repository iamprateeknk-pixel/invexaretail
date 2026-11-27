import { Download, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { stockActionIsAvailable } from '@/lib/stock-metadata';

export function StockOverviewActions({ page, role, handlers }) {
  const admin = role === 'ADMIN' || role === 'ADMIN_USER';
  return (
    <>
      <Button variant="outline" onClick={handlers?.saveView} disabled={!handlers}>Save view</Button>
      {stockActionIsAvailable(page, 'export', role) && <Button variant="outline" onClick={handlers?.export} disabled={!handlers}><Download className="size-4" />Export</Button>}
      {admin && stockActionIsAvailable(page, 'daily_import', role) && <Button variant="outline" onClick={handlers?.dailyImport} disabled={!handlers}>Daily sales / purchase</Button>}
      {admin && <Button variant="outline" onClick={handlers?.openingStock} disabled={!handlers}>Opening stock</Button>}
      {admin && <Button variant="outline" onClick={handlers?.archived} disabled={!handlers}>Archived items</Button>}
      {stockActionIsAvailable(page, 'scan', role) && <Button onClick={handlers?.scan} disabled={!handlers}><ScanLine className="size-4" />Scan item</Button>}
    </>
  );
}
