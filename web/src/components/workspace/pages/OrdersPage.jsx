import { useState } from 'react';
import { statusBadgeVariant, formatDateTime } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import OrderReturnsPanel from '../../OrderReturnsPanel';
import { ItemSearchSelect } from '../../ItemSearchSelect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RotateCcw, ShoppingBag } from 'lucide-react';

const CHANNELS = ['WEBSTORE', 'MARKETPLACE', 'POS', 'MANUAL'];

const EXPORT_COLUMNS = [
  { label: 'Channel', value: (r) => r.channel }, { label: 'Customer', value: (r) => r.customerName }, { label: 'Status', value: (r) => r.status },
  { label: 'External reference', value: (r) => r.externalReference }, { label: 'Created', value: (r) => r.createdAt },
];

export function OrdersPage() {
  const { items, locations, orders, orderForm, setOrderForm, createOrder, fulfillOrder, cancelOrder, retryBackorder, submitLoading, authToken, role } = useWorkspace();
  const { session } = useWorkspace();
  const view = useTableView(orders, (order) => [order.channel, order.customerName, order.status, order.externalReference, order.number, order.id]);
  const [returnsOrder, setReturnsOrder] = useState(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create channel order</CardTitle>
          <p className="text-xs text-muted-foreground">
            Reserves stock against the same available-to-promise pool as transfers - a store transfer and a
            webstore order for the same lot now genuinely compete for one pool instead of two.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select value={orderForm.channel} onValueChange={(channel) => setOrderForm({ ...orderForm, channel })}>
            <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
            <SelectContent>{CHANNELS.map((channel) => <SelectItem key={channel} value={channel}>{channel}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Customer name (optional)" value={orderForm.customerName} onChange={(event) => setOrderForm({ ...orderForm, customerName: event.target.value })} />
          <ItemSearchSelect items={items} value={orderForm.itemId} onChange={(itemId) => setOrderForm({ ...orderForm, itemId })} />
          <Input type="number" min="1" value={orderForm.quantity} onChange={(event) => setOrderForm({ ...orderForm, quantity: Number(event.target.value) })} />
          <Select
            value={orderForm.autoRoute ? 'auto' : orderForm.fulfillmentLocationId}
            onValueChange={(value) => value === 'auto' ? setOrderForm({ ...orderForm, autoRoute: true, fulfillmentLocationId: '' }) : setOrderForm({ ...orderForm, autoRoute: false, fulfillmentLocationId: value })}
          >
            <SelectTrigger><SelectValue placeholder="Fulfillment location" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-route (nearest eligible)</SelectItem>
              {locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button disabled={submitLoading || !orderForm.itemId} onClick={createOrder}><ShoppingBag className="size-4" />Reserve order</Button>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <Checkbox id="allow-split" disabled={!orderForm.autoRoute} checked={orderForm.allowSplit !== false} onCheckedChange={(checked) => setOrderForm({ ...orderForm, allowSplit: Boolean(checked) })} />
            <Label htmlFor="allow-split" className="text-xs font-normal text-muted-foreground">
              Allow split fulfilment across ranked locations when no single store or warehouse can fill the whole order.
            </Label>
          </div>
          <Input placeholder="Customer lat (optional)" value={orderForm.customerLatitude} onChange={(event) => setOrderForm({ ...orderForm, customerLatitude: event.target.value })} />
          <Input placeholder="Customer lng (optional)" value={orderForm.customerLongitude} onChange={(event) => setOrderForm({ ...orderForm, customerLongitude: event.target.value })} />
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
            <Checkbox id="allow-backorder" disabled={orderForm.autoRoute} checked={orderForm.allowBackorder} onCheckedChange={(checked) => setOrderForm({ ...orderForm, allowBackorder: Boolean(checked) })} />
            <Label htmlFor="allow-backorder" className="text-xs font-normal text-muted-foreground">
              Allow backorder (reserve what's available now, backorder the rest) - only with an explicit fulfillment location, not auto-route.
            </Label>
          </div>
        </CardContent>
      </Card>

      <TableToolbar tableId="orders" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search orders" exportCsv={{ filename: 'orders', columns: EXPORT_COLUMNS, rows: view.visible }} />

      <Card>
        <CardHeader><CardTitle className="text-base">Orders</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {view.visible.length ? view.visible.map((order) => (
            <div key={order.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border ${view.rowPadding}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{order.channel}{order.customerName ? ` · ${order.customerName}` : ''}</p>
                  <Badge variant={statusBadgeVariant(order.status)}>{order.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {order.lines?.map((line) => {
                    const loc = locations.find((entry) => entry.id === (line.fulfillmentLocationId || order.fulfillmentLocationId));
                    return `${line.item?.code ?? line.itemId} x${line.requestedQty}${line.lot ? ` (lot ${line.lot.lotNo})` : ' (backordered - no lot yet)'}${loc ? ` @ ${loc.name}` : ''}`;
                  }).join(', ')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(() => {
                    const splitIds = [...new Set((order.lines ?? []).map((line) => line.fulfillmentLocationId).filter(Boolean))];
                    const split = splitIds.length > 1;
                    return `${split ? `Split across ${splitIds.length} locations` : order.fulfillmentLocation?.name} · Created ${formatDateTime(order.createdAt)}`;
                  })()}
                  {order.status === 'RESERVED' && order.reservationExpiresAt ? ` · Reservation expires ${formatDateTime(order.reservationExpiresAt)}` : ''}
                  {order.status === 'EXPIRED' && order.expiredAt ? ` · Reservation expired ${formatDateTime(order.expiredAt)}, stock released` : ''}
                  {order.status === 'BACKORDERED' ? ' · Some lines are partially reserved; the rest fills automatically as stock arrives, or retry now' : ''}
                </p>
              </div>
              {order.status === 'RESERVED' && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={submitLoading} onClick={() => fulfillOrder(order.id)}>Fulfill</Button>
                  <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => cancelOrder(order.id)}>Cancel</Button>
                </div>
              )}
              {order.status === 'BACKORDERED' && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={submitLoading} onClick={() => retryBackorder(order.id)}>Retry backorder</Button>
                  <Button size="sm" variant="outline" disabled={submitLoading} onClick={() => cancelOrder(order.id)}>Cancel</Button>
                </div>
              )}
              {['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(role) && (order.lines ?? []).some((line) => (line.fulfilledQty ?? 0) > 0) && (
                <Button size="sm" variant="ghost" onClick={() => setReturnsOrder(order)}><RotateCcw className="size-4" />Returns</Button>
              )}
            </div>
          )) : <div className="py-16 text-center text-sm text-muted-foreground">No channel orders yet at this location.</div>}
        </CardContent>
      </Card>
      {returnsOrder && (
        <OrderReturnsPanel
          key={returnsOrder.id}
          order={returnsOrder}
          token={authToken}
          canManage={['ADMIN', 'ADMIN_USER', 'WAREHOUSE_PICKER'].includes(role)}
          onClose={() => setReturnsOrder(null)}
        />
      )}
    </div>
  );
}
