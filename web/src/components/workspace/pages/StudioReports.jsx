import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { remoteReportSources, studioReportResult } from '../../../lib/studio-report-data';
import { studioReportDefinition } from '../../../lib/studio-report-config';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorState, LoadingState } from '@/components/ui/feedback-states';

export function StudioReports() {
  const workspace = useWorkspace();
  const { runtimeConfig, locationId, authToken, downloadReportCsv } = workspace;
  const reports = runtimeConfig?.reports ?? [];
  const [selectedKey, setSelectedKey] = useState('');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const report = reports.find(({ key }) => key === selectedKey) ?? reports[0];
  const configured = report && studioReportDefinition(report);
  const source = configured && Object.hasOwn(remoteReportSources, report.entity) ? remoteReportSources[report.entity] : null;
  const resource = source && locationId && authToken
    ? `/api/v1/reports/studio/${source}?${new URLSearchParams({ reportKey: report.key, locationId })}` : null;
  const version = runtimeConfig?.version;

  useEffect(() => {
    if (!resource) return;
    const controller = new AbortController();
    const options = { signal: controller.signal, headers: { Authorization: `Bearer ${authToken}` } };
    const context = { resource, authToken, version, attempt };
    async function load() {
      try {
        const data = await apiRequest(resource, options);
        if (!Array.isArray(data?.rows) || !Array.isArray(data?.columns)) throw new Error('The report response was incomplete.');
        if (!controller.signal.aborted) setResult({ ...context, data });
      } catch (error) {
        if (controller.signal.aborted) return;
        // Database-free demo keeps the existing local report behavior.
        if (error?.status === 501) {
          try {
            const response = await apiRequest(`/api/v1/${source}?${new URLSearchParams({ locationId })}`, options);
            const remote = response[source === 'orders' ? 'orders' : 'purchaseOrders'];
            if (!Array.isArray(remote)) throw new Error('The report response was incomplete.');
            if (!controller.signal.aborted) setResult({ ...context, remote });
          } catch (fallbackError) {
            if (!controller.signal.aborted) setResult({ ...context, error: fallbackError.message });
          }
          return;
        }
        if (!controller.signal.aborted) setResult({ ...context, error: error.message });
      }
    }
    void load();
    return () => controller.abort();
  }, [resource, authToken, version, attempt, source, locationId]);

  if (!reports.length) return null;
  const current = result?.resource === resource && result?.authToken === authToken
    && result?.version === version && result?.attempt === attempt ? result : null;
  const definition = current?.data ?? configured;
  const reportResult = current?.data ?? (configured && locationId && (!source || current?.remote)
    ? studioReportResult(report, configured, { ...workspace, remote: current?.remote }) : null);
  const rows = reportResult?.rows ?? [];

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
        {report && (!definition ? <p role="status">This report has an unsupported configuration. Update it in Studio.</p>
          : !locationId ? <p role="status">Choose a location to run this report.</p>
          : current?.error ? <ErrorState title="Could not run this report" description={current.error}
            onRetry={() => setAttempt((value) => value + 1)} className="min-h-24" />
          : source && !reportResult ? <LoadingState label="Loading report data…" className="min-h-24" />
          : <>
            {current?.remote && <p className="text-sm text-muted-foreground">Demo report using up to 200 recent records.</p>}
            {reportResult?.truncated && <p role="status" className="text-sm text-muted-foreground">
              Showing and exporting {rows.length} of {reportResult.total} matching {definition.groupBy ? 'groups' : 'records'}.
            </p>}
            <Table>
              <TableHeader><TableRow>{definition.columns.map(({ key, label }) => <TableHead key={key}>{label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{rows.length ? rows.map((row, index) => (
                <TableRow key={index}>{definition.columns.map(({ key, label }) => (
                  <TableCell key={key}>
                    {definition.chart && key === 'records' && <meter aria-hidden="true" className="mr-3 w-24 align-middle accent-primary"
                      min={0} max={rows[0].Records} value={row.Records} />}
                    {row[label] === '' && key === definition.groupBy ? 'No value' : String(row[label])}
                  </TableCell>
                ))}</TableRow>
              )) : <TableRow><TableCell colSpan={definition.columns.length}>No records match this report at this location.</TableCell></TableRow>}</TableBody>
            </Table>
          </>)}
      </CardContent>
    </Card>
  );
}
