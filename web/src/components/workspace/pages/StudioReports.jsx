import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { remoteReportPaths, studioReportDefinition, studioReportRows } from '../../../lib/studio-report-data';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function StudioReports() {
  const workspace = useWorkspace();
  const { runtimeConfig, locationId, authToken, downloadReportCsv } = workspace;
  const reports = runtimeConfig?.reports ?? [];
  const [selectedKey, setSelectedKey] = useState('');
  const [result, setResult] = useState(null);
  const report = reports.find(({ key }) => key === selectedKey) ?? reports[0];
  const definition = report && studioReportDefinition(report);
  const endpoint = definition && Object.hasOwn(remoteReportPaths, report.entity) ? remoteReportPaths[report.entity] : null;
  const resource = endpoint && locationId && authToken ? `${endpoint}?locationId=${encodeURIComponent(locationId)}` : null;

  useEffect(() => {
    if (!resource) return;
    const controller = new AbortController();
    apiRequest(resource, { signal: controller.signal, headers: { Authorization: `Bearer ${authToken}` } })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ resource, authToken, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ resource, authToken, error: true });
      });
    return () => controller.abort();
  }, [resource, authToken]);

  if (!reports.length) return null;
  const current = result?.resource === resource && result?.authToken === authToken ? result : null;
  const remote = current?.data?.[report?.entity === 'purchase_orders' ? 'purchaseOrders' : 'orders'];
  const remoteReady = Array.isArray(remote);
  const rows = definition && locationId && (!endpoint || remoteReady)
    ? studioReportRows(report, definition, { ...workspace, remote }) : [];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Published Studio reports</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={report?.key ?? ''} onValueChange={setSelectedKey}>
            <SelectTrigger aria-label="Published report" className="w-64"><SelectValue placeholder="Choose a report" /></SelectTrigger>
            <SelectContent>{reports.map(({ key, name }) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" disabled={!rows.length} onClick={() => downloadReportCsv(rows, `studio-${report.key}`)}>Export published report</Button>
        </div>
        {report && (!definition ? <p role="status">This report has an unsupported dataset, column or filter. Update it in Studio.</p>
          : !locationId ? <p role="status">Choose a location to run this report.</p>
          : current?.error || (current?.data && !remoteReady) ? <p role="alert">The report data is unavailable. Refresh to try again.</p>
          : endpoint && !remoteReady ? <p role="status">Loading report data…</p>
          : <>
            {endpoint && <p className="text-sm text-muted-foreground">Shows up to 200 recent records for the selected location.</p>}
            <Table>
              <TableHeader><TableRow>{definition.columns.map(({ key, label }) => <TableHead key={key}>{label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{rows.length ? rows.map((row, index) => (
                <TableRow key={index}>{definition.columns.map(({ key, label }) => <TableCell key={key}>{String(row[label])}</TableCell>)}</TableRow>
              )) : <TableRow><TableCell colSpan={definition.columns.length}>No records match this report at this location.</TableCell></TableRow>}</TableBody>
            </Table>
          </>)}
      </CardContent>
    </Card>
  );
}
