import { useMemo, useState } from 'react';
import { AlertTriangle, Ban, CalendarClock, CircleAlert, FileWarning, Search, Truck } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { itemFieldCell } from '@/hooks/useItemFieldValues';
import { formatStockFormulaValue } from '@/lib/stock-table';
import { DEFAULT_LOT_COLUMNS, lotFormulaValue } from '@/lib/lots-table';
import {
  filterExpiryLots,
  formatExpiryDays,
  formatInr,
  horizonBadgeVariant,
} from '@/lib/expiry-board';

const FILTERS = [
  { key: 'action', label: 'Action queue' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'CRITICAL', label: '0–7 days' },
  { key: 'WARNING', label: '8–30 days' },
  { key: 'UPCOMING', label: '31–90 days' },
  { key: 'MISSING', label: 'Missing date' },
  { key: 'dated', label: 'All dated' },
  { key: 'all', label: 'All on-hand' },
];

const QUEUE_LIMIT = 250;

function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString('en-IN');
}

function lotCellClass(key) {
  if (key === 'quantity') return 'font-semibold';
  if (key === 'recommended_action') return 'hidden max-w-xs text-xs text-muted-foreground lg:table-cell';
  if (key === 'open') return 'text-right';
  return undefined;
}

function renderLotCell(column, lot, { itemFieldValues, openLot }) {
  if (column.source === 'itemField') return itemFieldCell(itemFieldValues, lot.itemId, column.itemField);
  if (column.formula) return formatStockFormulaValue(lotFormulaValue(column.formula, lot), column.type);
  switch (column.key) {
    case 'item_lot':
      return (<><p className="font-medium">{lot.itemName}</p><p className="text-xs text-muted-foreground">{lot.itemCode} · Lot {lot.lotNo} · {lot.category}</p></>);
    case 'quantity':
      return (<>{lot.quantity}<p className="text-xs font-normal text-muted-foreground">{lot.unit}</p></>);
    case 'expiry':
      return (<>{formatDate(lot.expiryDate)}<p className="text-xs text-muted-foreground">{formatExpiryDays(lot)}</p></>);
    case 'risk':
      return (<><Badge variant={horizonBadgeVariant(lot.horizon)}>{lot.horizon}</Badge>{lot.lotStatus && lot.lotStatus !== 'AVAILABLE' ? <Badge className="mt-1" variant="outline">{lot.lotStatus}</Badge> : null}</>);
    case 'recommended_action':
      return lot.recommendedAction;
    case 'open':
      return <Button size="sm" variant="outline" onClick={() => openLot(lot)}>Open</Button>;
    default:
      return '—';
  }
}

export default function ExpiryBoard({
  lots = [],
  summary,
  categories = [],
  locationName,
  role,
  loading = false,
  columns = DEFAULT_LOT_COLUMNS,
  itemFieldValues = {},
  onWriteOff,
  onSetExpiry,
  onSetLotStatus,
  onStartTransfer,
}) {
  const [filter, setFilter] = useState('action');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState(null);
  const [expiryDraft, setExpiryDraft] = useState('');
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffQty, setWriteOffQty] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('Expired stock verified and removed');

  const canAdmin = ['ADMIN', 'ADMIN_USER'].includes(role);
  const canWriteOff = role === 'ADMIN';

  const visibleLots = useMemo(
    () => filterExpiryLots(lots, { filter, search, category }),
    [lots, filter, search, category],
  );
  const shownLots = visibleLots.slice(0, QUEUE_LIMIT);

  function openLot(lot) {
    setSelected(lot);
    setExpiryDraft(toDateInput(lot.expiryDate));
  }

  function closeLot() {
    setSelected(null);
    setWriteOffOpen(false);
  }

  const kpis = [
    { key: 'EXPIRED', label: 'Expired lots', value: summary?.expiredLots ?? 0, detail: `${Math.round(summary?.expiredQty ?? 0)} units · ${formatInr(summary?.expiredValue)}`, tone: 'destructive' },
    { key: 'CRITICAL', label: 'Due in 7 days', value: summary?.criticalLots ?? 0, detail: `${Math.round(summary?.criticalQty ?? 0)} units at this location`, tone: 'warning' },
    { key: 'WARNING', label: '8–30 days', value: summary?.warningLots ?? 0, detail: `${Math.round(summary?.warningQty ?? 0)} units to sell or move`, tone: 'warning' },
    { key: 'UPCOMING', label: '31–90 days', value: summary?.upcomingLots ?? 0, detail: `${Math.round(summary?.upcomingQty ?? 0)} units under FEFO watch`, tone: 'secondary' },
    { key: 'MISSING', label: 'Missing expiry', value: summary?.missingLots ?? 0, detail: `${Math.round(summary?.missingQty ?? 0)} units without a date`, tone: 'outline' },
    { key: 'risk', label: 'Value at risk', value: formatInr(summary?.atRiskValue), detail: `${summary?.atRiskLots ?? 0} lots · ${Math.round(summary?.atRiskQty ?? 0)} units ≤ 90 days`, tone: 'secondary' },
  ];

  return (
    <div className="space-y-6">
      {(summary?.missingLots > 0 || summary?.expiredLots > 0) && (
        <Alert variant={summary.expiredLots > 0 ? 'destructive' : 'default'}>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {summary.expiredLots > 0
              ? `${summary.expiredLots} expired lots and ${Math.round(summary.expiredQty)} units need write-off or blocking at ${locationName}.`
              : null}
            {summary.expiredLots > 0 && summary.missingLots > 0 ? ' ' : null}
            {summary.missingLots > 0
              ? `${summary.missingLots} on-hand lots have no expiry date. FEFO cannot allocate them until a date is added.`
              : null}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((card) => (
          <button key={card.key} type="button" onClick={() => setFilter(card.key)} className="text-left">
            <Card className={filter === card.key ? 'border-primary ring-1 ring-primary/40' : ''}>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight">{card.value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{card.detail}</p>
                <Badge className="mt-3" variant={card.tone}>{locationName}</Badge>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-4 border-b p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold">Lots & expiry control</p>
              <p className="mt-1 text-xs text-muted-foreground">
                FEFO queue for current stock at {locationName}. Open a lot to set a date, block sale, write off, or start a transfer.
              </p>
            </div>
            <Badge variant="secondary">{visibleLots.length} lots</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((option) => (
              <Button key={option.key} size="sm" variant={filter === option.key ? 'default' : 'outline'} onClick={() => setFilter(option.key)}>
                {option.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, code, lot or company" className="pl-9" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className={`${column.key === 'recommended_action' ? 'hidden lg:table-cell' : ''} ${column.key === 'open' ? 'text-right' : ''}`.trim() || undefined}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shownLots.length ? shownLots.map((lot) => (
              <TableRow
                key={lot.id}
                className={lot.horizon === 'EXPIRED' ? 'bg-destructive/5' : lot.horizon === 'CRITICAL' || lot.horizon === 'WARNING' ? 'bg-warning/10' : lot.horizon === 'MISSING' ? 'bg-muted/40' : ''}
              >
                {columns.map((column) => (
                  <TableCell key={column.key} className={lotCellClass(column.key)}>{renderLotCell(column, lot, { itemFieldValues, openLot })}</TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">
                  {loading
                    ? 'Loading lot expiry…'
                    : filter === 'MISSING'
                      ? 'Every on-hand lot at this location already has an expiry date.'
                      : filter === 'action'
                        ? 'No expired, 30-day or missing-date lots at this location.'
                        : 'No lots match this expiry filter.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {visibleLots.length > QUEUE_LIMIT ? (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Showing the first {QUEUE_LIMIT} of {visibleLots.length} lots. Search or narrow the filter to work a smaller queue.
          </p>
        ) : null}
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeLot(); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.itemName}</SheetTitle>
                <SheetDescription>{selected.itemCode} · Lot {selected.lotNo} · {selected.quantity} {selected.unit} at {locationName}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={horizonBadgeVariant(selected.horizon)}>{selected.horizon}</Badge>
                  <Badge variant="outline">{selected.lotStatus}</Badge>
                  <Badge variant="secondary">{selected.category}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground">Expiry</p><p className="font-medium">{formatDate(selected.expiryDate)}</p></div>
                  <div><p className="text-muted-foreground">Horizon</p><p className="font-medium">{formatExpiryDays(selected)}</p></div>
                  <div><p className="text-muted-foreground">Purchase value</p><p className="font-medium">{formatInr(selected.purchaseValue)}</p></div>
                  <div><p className="text-muted-foreground">Sale value</p><p className="font-medium">{formatInr(selected.saleValue)}</p></div>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{selected.recommendedAction}</p>
                <Separator />
                {canAdmin ? (
                  <div className="grid gap-2">
                    <Label htmlFor="expiry-date">Set expiry date</Label>
                    <Input id="expiry-date" type="date" value={expiryDraft} onChange={(event) => setExpiryDraft(event.target.value)} />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!expiryDraft || loading}
                      onClick={() => onSetExpiry?.(selected, expiryDraft)}
                    >
                      <CalendarClock className="size-4" />
                      Save expiry date
                    </Button>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Button type="button" variant="outline" onClick={() => onStartTransfer?.(selected)}>
                    <Truck className="size-4" />
                    Start FEFO transfer
                  </Button>
                  {canAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading || selected.lotStatus === 'BLOCKED'}
                      onClick={() => onSetLotStatus?.(selected, selected.lotStatus === 'EXPIRED' ? 'AVAILABLE' : 'EXPIRED')}
                    >
                      <CircleAlert className="size-4" />
                      {selected.lotStatus === 'EXPIRED' ? 'Mark lot available' : 'Mark lot expired'}
                    </Button>
                  ) : null}
                  {canAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loading || selected.lotStatus === 'BLOCKED'}
                      onClick={() => onSetLotStatus?.(selected, 'BLOCKED')}
                    >
                      <Ban className="size-4" />
                      Block sale of this lot
                    </Button>
                  ) : null}
                  {canWriteOff ? (
                    <Button type="button" variant="destructive" disabled={loading} onClick={() => { setWriteOffQty(String(selected.quantity)); setWriteOffOpen(true); }}>
                      <FileWarning className="size-4" />
                      Write off stock
                    </Button>
                  ) : null}
                </div>
              </div>
              <SheetFooter>
                <Button type="button" variant="outline" onClick={closeLot}>Close</Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={writeOffOpen} onOpenChange={setWriteOffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write off expired stock</DialogTitle>
            <DialogDescription>
              This removes quantity from the stock ledger with an EXPIRY_WRITE_OFF movement and an audit record. Only Main Admin can post it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="write-off-qty">Quantity</Label>
              <Input id="write-off-qty" type="number" min="0.001" step="0.001" value={writeOffQty} onChange={(event) => setWriteOffQty(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="write-off-reason">Reason</Label>
              <Textarea id="write-off-reason" value={writeOffReason} onChange={(event) => setWriteOffReason(event.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setWriteOffOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={loading || writeOffReason.trim().length < 5}
              onClick={async () => {
                await onWriteOff?.(selected, Number(writeOffQty), writeOffReason.trim());
                setWriteOffOpen(false);
                closeLot();
              }}
            >
              Post write-off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
