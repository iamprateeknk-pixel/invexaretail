import { REPORT_TYPE_LABELS } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Boxes, CheckCircle2, ClipboardCheck, PackageCheck, Truck } from 'lucide-react';

export function ReportsPage() {
  const {
        stockRows, reportSummary, varianceReport, currentReportRows, reportType, setReportType,
    savedReports, locations, setLocationId, saveCurrentReport, submitLoading, downloadReportCsv,
    deleteSavedReport, currentLocationName,
  } = useWorkspace();
  const reportCards = [
    ['Stock records', stockRows.length, 'Items with stock at this location', Boxes],
    ['Total counts', reportSummary?.totalCounts ?? 0, 'Submitted physical counts', ClipboardCheck],
    ['Total transfers', reportSummary?.totalTransfers ?? 0, 'Inbound and outbound transfers', Truck],
    ['Dispatched', reportSummary?.dispatchedTransfers ?? 0, 'Transfers currently dispatched', PackageCheck],
    ['Matching items', varianceReport?.matchingItems ?? 0, 'Book and physical quantity match', CheckCircle2],
    ['Variance', `${varianceReport?.overallVariancePercent ?? 0}%`, `${varianceReport?.shortageItems ?? 0} shortage · ${varianceReport?.overageItems ?? 0} overage`, AlertTriangle],
  ];
  const reportColumns = currentReportRows.length ? Object.keys(currentReportRows[0]) : [];
  return <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{reportCards.map(([name, value, description, Icon]) => <Card key={name}><CardContent className="flex items-start gap-4 p-5"><div className="rounded-lg bg-primary/10 p-2.5 text-primary"><Icon className="size-5" /></div><div><p className="text-sm text-muted-foreground">{name}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></CardContent></Card>)}</div>
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Report workspace</CardTitle><p className="mt-1 text-xs text-muted-foreground">Preview, save and export location-scoped operational reports.</p></div><Badge variant="secondary">{currentReportRows.length} rows</Badge></div>
        <div className="flex flex-wrap gap-2">
          <Select value={reportType} onValueChange={setReportType}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          {savedReports.length > 0 && <Select onValueChange={(id) => { const report = savedReports.find((entry) => entry.id === id); if (report) { setReportType(report.reportType); if (report.locationId && locations.some((location) => location.id === report.locationId)) setLocationId(report.locationId); } }}><SelectTrigger className="w-52"><SelectValue placeholder="Open saved report" /></SelectTrigger><SelectContent>{savedReports.map((report) => <SelectItem key={report.id} value={report.id}>{report.name}{report.isShared ? ' · Shared' : ''}</SelectItem>)}</SelectContent></Select>}
          <Button variant="outline" onClick={saveCurrentReport} disabled={submitLoading}>Save report</Button>
          <Button onClick={() => downloadReportCsv(currentReportRows)} disabled={!currentReportRows.length}>Export CSV</Button>
        </div>
        {savedReports.length > 0 && <div className="flex flex-wrap gap-2">{savedReports.map((report) => <div key={report.id} className="flex items-center rounded-md border bg-muted/25"><button type="button" className="px-2.5 py-1.5 text-xs font-medium" onClick={() => { setReportType(report.reportType); if (report.locationId) setLocationId(report.locationId); }}>{report.name}</button><button type="button" className="border-l px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => deleteSavedReport(report.id)} aria-label={`Delete ${report.name}`}>×</button></div>)}</div>}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto"><Table><TableHeader><TableRow>{reportColumns.map((column) => <TableHead key={column}>{column.replace(/([a-z])([A-Z])/g, '$1 $2')}</TableHead>)}</TableRow></TableHeader><TableBody>{currentReportRows.length ? currentReportRows.map((row, index) => <TableRow key={`${reportType}-${index}`}>{reportColumns.map((column) => <TableCell key={column} className={column === 'Item' ? 'font-medium' : ''}>{String(row[column] ?? '')}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={Math.max(reportColumns.length, 1)} className="h-40 text-center text-muted-foreground">No records match this report at {currentLocationName}.</TableCell></TableRow>}</TableBody></Table></div>
      </CardContent>
    </Card>
  </div>;
}
