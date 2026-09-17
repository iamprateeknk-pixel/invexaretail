import { formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, CheckCircle2 } from 'lucide-react';

export function AlertsPage() {
  const {
        lowStockRows, expiringSoonCount, pendingCountTasks, notifications, markNotificationRead,
    navigateTo, auditEvents, exceptionSummary, overdueAssetCheckouts,
  } = useWorkspace();
  const activity = auditEvents;
  const operationalAlerts = [
    ...(exceptionSummary?.open ? [{ id: 'open-exceptions', title: `${exceptionSummary.open} open exception cases`, description: `${exceptionSummary.overdue ?? 0} overdue, ${exceptionSummary.critical ?? 0} critical - claim and resolve in the Exception Inbox.`, section: 'exceptions', tone: 'destructive' }] : []),
    ...(overdueAssetCheckouts?.length ? [{ id: 'overdue-assets', title: `${overdueAssetCheckouts.length} overdue asset checkout${overdueAssetCheckouts.length === 1 ? '' : 's'}`, description: `${overdueAssetCheckouts.slice(0, 3).map((entry) => entry.assigneeName).join(', ')}${overdueAssetCheckouts.length > 3 ? ', …' : ''} - past due date, chase for return.`, section: 'assets', tone: 'destructive' }] : []),
    ...(lowStockRows.length ? [{ id: 'low-stock', title: `${lowStockRows.length} low-stock items`, description: 'Review current stock and start replenishment.', section: 'inventory', tone: 'destructive' }] : []),
    ...(expiringSoonCount ? [{ id: 'expiry-risk', title: `${expiringSoonCount} lots need expiry action`, description: 'Expired, 30-day or missing-date lots are waiting in the FEFO queue.', section: 'expiry', tone: 'warning' }] : []),
    ...(pendingCountTasks.length ? [{ id: 'count-work', title: `${pendingCountTasks.length} count tasks pending`, description: 'Assigned or submitted counts need action.', section: 'counts', tone: 'warning' }] : []),
    ...notifications,
  ];
  return <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Notification inbox</CardTitle></CardHeader><CardContent className="space-y-2">{operationalAlerts.length ? operationalAlerts.map((notice) => <button type="button" key={notice.id} onClick={() => { markNotificationRead(notice); if (notice.section) navigateTo(notice.section); }} className={`flex w-full gap-3 rounded-lg border p-3 text-left transition hover:bg-muted/50 ${notice.persisted && !notice.readAt ? 'border-primary/40 bg-primary/5' : ''}`}><Bell className={`mt-0.5 size-4 ${notice.tone === 'destructive' || notice.type === 'error' ? 'text-destructive' : 'text-primary'}`} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{notice.title}</p>{notice.persisted && !notice.readAt && <Badge variant="secondary">New</Badge>}</div><p className="text-xs text-muted-foreground">{notice.description}</p></div></button>) : <div className="py-12 text-center text-sm text-muted-foreground"><CheckCircle2 className="mx-auto mb-3 size-8 text-emerald-500" />You are all caught up.</div>}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader><CardContent className="space-y-4">{activity.length ? activity.slice(0, 8).map((event) => <div key={event.id ?? event.name} className="flex gap-3"><div className="mt-1 size-2 rounded-full bg-primary" /><div><p className="text-sm font-medium">{event.name ?? event.action}</p><p className="text-xs text-muted-foreground">{event.scope ?? event.entityId ?? 'All locations'} · {formatDateTime(event.createdAt)}</p></div></div>) : <div className="py-12 text-center text-sm text-muted-foreground">No audit activity is available for this role.</div>}</CardContent></Card></div>;
}
