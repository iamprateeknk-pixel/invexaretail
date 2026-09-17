import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ItemSearchSelect } from '../../ItemSearchSelect';

export function AssetsPage() {
  const {
        role, assetForm, setAssetForm, items, createAssetCheckout, submitLoading, assetCheckouts,
    returnAssetCheckout,
  } = useWorkspace();
  return <div className="space-y-6">
    {role === 'ADMIN' && <Card><CardHeader><CardTitle className="text-base">Check out controlled inventory</CardTitle><p className="text-xs text-muted-foreground">Assign equipment or tracked stock with due date and condition.</p></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><ItemSearchSelect items={items} value={assetForm.itemId} onChange={(itemId) => setAssetForm({ ...assetForm, itemId })} /><Input value={assetForm.assigneeName} onChange={(event) => setAssetForm({ ...assetForm, assigneeName: event.target.value })} placeholder="Person / department" /><Input type="number" min="1" value={assetForm.quantity} onChange={(event) => setAssetForm({ ...assetForm, quantity: Number(event.target.value) })} /><Input type="date" value={assetForm.dueAt} onChange={(event) => setAssetForm({ ...assetForm, dueAt: event.target.value })} /><Button onClick={createAssetCheckout} disabled={submitLoading || !assetForm.itemId || !assetForm.assigneeName.trim()}>Check out</Button><Input className="md:col-span-2 xl:col-span-5" value={assetForm.conditionOut} onChange={(event) => setAssetForm({ ...assetForm, conditionOut: event.target.value })} placeholder="Condition / handover notes" /></CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">Assignment register</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Assigned to</TableHead><TableHead>Quantity</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{assetCheckouts.length ? assetCheckouts.map((entry) => <TableRow key={entry.id}><TableCell className="font-medium">{items.find((item) => item.id === entry.itemId)?.name ?? entry.itemId}</TableCell><TableCell>{entry.assigneeName}</TableCell><TableCell>{entry.quantity}</TableCell><TableCell>{entry.dueAt ? new Date(entry.dueAt).toLocaleDateString('en-IN') : 'Open'}</TableCell><TableCell><Badge variant={entry.status === 'RETURNED' ? 'success' : 'warning'}>{entry.status}</Badge></TableCell><TableCell className="text-right">{entry.status !== 'RETURNED' && role !== 'AUDITOR' && <Button size="sm" variant="outline" onClick={() => returnAssetCheckout(entry.id)}>Record return</Button>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted-foreground">No assets are checked out at this location.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
  </div>;
}
