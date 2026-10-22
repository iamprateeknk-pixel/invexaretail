import { controlRequest } from '../control-api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormulaBuilder } from '../FormulaBuilder';
import { ImportColumnsEditor } from '../ImportColumnsEditor';
import { StockColumnsLayoutEditor } from '../StockColumnsLayoutEditor';
import { Advanced } from '../studio-mode';
import { AutomationsEditor, FieldsEditor, MobilePolicyEditor, ReportsEditor, RulesEditor, StockExtraColumnCard } from '../StudioEditors';
import { labelOf, ROLE_OPTIONS } from '../studio-catalog';

export function StudioSection(props) {
  const { error, setError, draft, runtime, previewRole, setPreviewRole, controlToken, refreshLocked } = props;
  return (
    <Tabs defaultValue="columns">
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="columns">Stock columns</TabsTrigger>
        <TabsTrigger value="import-columns">Import columns</TabsTrigger>
        <TabsTrigger value="formulas">Formulas</TabsTrigger>
        <TabsTrigger value="fields">Extra fields</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="automations">Automations</TabsTrigger>
        <TabsTrigger value="mobile-policy">Mobile app</TabsTrigger>
        <TabsTrigger value="preview">Publish</TabsTrigger>
      </TabsList>
      <TabsContent value="formulas" className="grid gap-4">
        <FormulaBuilder controlToken={controlToken} onSaved={refreshLocked} />
      </TabsContent>
      <TabsContent value="import-columns" className="grid gap-4">
        <ImportColumnsEditor controlToken={controlToken} />
      </TabsContent>
      <TabsContent value="columns" className="grid gap-4">
        <StockColumnsLayoutEditor controlToken={controlToken} onSaved={refreshLocked} />
        <StockExtraColumnCard controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
        <Advanced label="Advanced: raw draft columns">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Draft columns</CardTitle>
            <Button variant="outline" onClick={async () => {
              await controlRequest('/studio/v1/draft/actions/export', { token: controlToken, method: 'POST', body: { enabled: false } });
              await refreshLocked();
              toast.message('Export disabled in draft');
            }}>Disable export</Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Label</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
              <TableBody>
                {(draft?.page?.columns ?? []).map((column) => (
                  <TableRow key={column.key}><TableCell>{column.key}</TableCell><TableCell>{column.label}</TableCell><TableCell>{column.source}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </Advanced>
      </TabsContent>
      <TabsContent value="fields" className="grid gap-4">
        <FieldsEditor controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
      </TabsContent>
      <TabsContent value="rules" className="grid gap-4">
        <RulesEditor controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
      </TabsContent>
      <TabsContent value="reports" className="grid gap-4">
        <ReportsEditor controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
      </TabsContent>
      <TabsContent value="automations" className="grid gap-4">
        <AutomationsEditor controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
      </TabsContent>
      <TabsContent value="mobile-policy" className="grid gap-4">
        <MobilePolicyEditor controlToken={controlToken} draft={draft} onSaved={refreshLocked} />
      </TabsContent>
      <TabsContent value="preview" className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Select value={previewRole} onValueChange={setPreviewRole}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['ADMIN', 'BRANCH_MANAGER', 'STORE_USER', 'WAREHOUSE_PICKER', 'AUDITOR'].map((role) => (
                <SelectItem key={role} value={role}>{labelOf(ROLE_OPTIONS, role)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={async () => {
            const preview = await controlRequest('/studio/v1/preview', { token: controlToken, method: 'POST', body: { role: previewRole, device: 'desktop' } });
            toast.success(`${labelOf(ROLE_OPTIONS, previewRole)} would see ${preview.preview.page.columns.length} stock columns`);
          }}>See what this role gets</Button>
          <Button onClick={async () => {
            try {
              await controlRequest('/studio/v1/publish', { token: controlToken, method: 'POST' });
              await refreshLocked().catch((caught) => setError(caught.message));
              setError('');
              toast.success('Published');
            } catch (caught) {
              const message = caught instanceof Error ? caught.message : 'Publish failed';
              setError(message);
              toast.error(message);
            }
          }}>Publish</Button>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">What is live now</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Published version {runtime?.version ?? '—'} · stock columns: {(runtime?.page?.columns ?? []).map((column) => column.label).join(' · ')}
            <p className="mt-2">Items & stock in the grocery workspace uses this published page: custom columns and enabled header actions.</p>
          </CardContent>
        </Card>
        <Advanced label="Advanced: undo">
          <div>
            <Button variant="outline" onClick={async () => {
            await controlRequest('/studio/v1/rollback', { token: controlToken, method: 'POST', body: { version: 1 } });
            await refreshLocked();
            toast.message('Rolled back to version 1');
          }}>Go back to version 1</Button>
          </div>
        </Advanced>
      </TabsContent>
    </Tabs>
  );
}
