import { useWorkspace } from '../WorkspaceContext';
import SmartFoldersCard from '../../SmartFoldersCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function CatalogPage() {
  const {
        newTagName, setNewTagName, createTag, role, submitLoading, tags, newField, setNewField,
    createCustomField, customFields, authToken,
  } = useWorkspace();
  return <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Product tags</CardTitle><p className="text-xs text-muted-foreground">Reusable labels for filtering and saved views.</p></CardHeader><CardContent className="space-y-4"><div className="flex gap-2"><Input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="e.g. Premium, Fragile, Seasonal" disabled={role !== 'ADMIN'} /><Button onClick={createTag} disabled={role !== 'ADMIN' || submitLoading || !newTagName.trim()}>Add tag</Button></div><div className="flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <Badge key={tag.id} variant="secondary" className="px-3 py-1.5">{tag.name}<span className="ml-2 text-muted-foreground">{tag._count?.items ?? 0}</span></Badge>) : <p className="py-8 text-sm text-muted-foreground">No tags created yet.</p>}</div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Custom fields</CardTitle><p className="text-xs text-muted-foreground">Add product metadata without changing core item fields.</p></CardHeader><CardContent className="space-y-4"><div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]"><Input value={newField.name} onChange={(event) => setNewField({ ...newField, name: event.target.value })} placeholder="Field name" disabled={role !== 'ADMIN'} /><Select value={newField.type} onValueChange={(type) => setNewField({ ...newField, type })}><SelectTrigger disabled={role !== 'ADMIN'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="date">Date</SelectItem><SelectItem value="boolean">Yes / No</SelectItem><SelectItem value="select">Select</SelectItem></SelectContent></Select><Button onClick={createCustomField} disabled={role !== 'ADMIN' || submitLoading || !newField.name.trim()}>Add field</Button></div><div className="divide-y rounded-lg border">{customFields.length ? customFields.map((field) => <div key={field.id} className="flex items-center justify-between p-3"><div><p className="text-sm font-medium">{field.name}</p><p className="text-xs text-muted-foreground">{field.type}</p></div><Badge variant="outline">{field.required ? 'Required' : 'Optional'}</Badge></div>) : <p className="p-8 text-center text-sm text-muted-foreground">No custom fields configured.</p>}</div></CardContent></Card><SmartFoldersCard token={authToken} tags={tags} canManage /></div>;
}
