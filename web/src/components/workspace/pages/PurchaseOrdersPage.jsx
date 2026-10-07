import { useState } from 'react';
import { poActions, receiptProgress, urgencyVariant } from '../../../lib/procurement';
import { statusBadgeVariant } from '../../../lib/workspace';
import { useWorkspace } from '../WorkspaceContext';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { DEFAULT_TABLE_STATE } from '../../../lib/table-state';
import { useTableView } from '../../../hooks/useTableView';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ItemSearchSelect } from '../../ItemSearchSelect';

function PurchasePlan({ locations, suppliers, plan, loadPurchasePlan, draftFromPlan, submitLoading }) {
  const [locationId, setLocationId] = useState('');
  const [chosen, setChosen] = useState({});
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Purchase plan</CardTitle>
          <p className="text-xs text-muted-foreground">What to reorder, worked out from stock, open orders, stock in transit, sales and supplier lead times. Nothing is ordered until you create a draft.</p>
        </div>
        <div className="flex gap-2">
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Location" /></SelectTrigger>
            <SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button disabled={!locationId || submitLoading} onClick={() => loadPurchasePlan(locationId)}>Build plan</Button>
        </div>
      </CardHeader>
      {plan && (
        <CardContent className="space-y-4">
          {plan.note && <p className="text-sm text-muted-foreground">{plan.note}</p>}
          {!plan.groups.length && !plan.note && <p className="text-sm text-muted-foreground">Nothing needs ordering right now.</p>}
          {plan.groups.map((group, index) => (
            <div key={`${group.supplierId ?? 'none'}-${index}`} className="rounded-lg border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <p className="text-sm font-medium">{group.supplierName ?? 'No supplier on record'} <span className="text-xs font-normal text-muted-foreground">· {group.lines.length} line{group.lines.length === 1 ? '' : 's'}{group.estimatedTotal ? ` · about ₹${group.estimatedTotal.toLocaleString('en-IN')}` : ''}</span></p>
                <div className="flex gap-2">
                  {!group.supplierId && (
                    <Select value={chosen[index] ?? ''} onValueChange={(value) => setChosen({ ...chosen, [index]: value })}>
                      <SelectTrigger className="w-44"><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                      <SelectContent>{suppliers.filter((supplier) => !supplier.status || supplier.status === 'ACTIVE').map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <Button size="sm" disabled={submitLoading || (!group.supplierId && !chosen[index])} onClick={() => draftFromPlan(group, plan.locationId, chosen[index])}>Create draft PO</Button>
                </div>
              </div>
              <div className="divide-y">
                {group.lines.map((line) => (
                  <details key={line.itemId} className="px-3 py-2 text-sm">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{line.code ?? line.itemId} <span className="font-normal text-muted-foreground">{line.name}</span></span>
                      <span className="flex items-center gap-2"><Badge variant={urgencyVariant(line.urgency)}>{line.urgency.toLowerCase()}</Badge><span>order {line.quantity}</span><span className="text-xs text-muted-foreground">{line.confidence.toLowerCase()} confidence</span></span>
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {line.explanation.map((sentence) => <li key={sentence}>{sentence}</li>)}
                      {line.daysOfCover !== null && <li>About {line.daysOfCover} day(s) of cover at the current sales rate.</li>}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          ))}
          {plan.skipped.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Not ordered ({plan.skipped.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{plan.skipped.map((row) => <li key={row.reason}>{row.reason}</li>)}</ul>
            </details>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function PurchaseOrdersPage() {
  const {
    role, newSupplier, setNewSupplier, createSupplier, submitLoading, purchaseOrderForm,
    setPurchaseOrderForm, suppliers, locations, items, createPurchaseOrder, purchaseOrders,
    openPurchaseReceipt, changePurchaseOrderStatus, purchasePlan, loadPurchasePlan, draftFromPlan,
  } = useWorkspace();
  const { session } = useWorkspace();
  const view = useTableView(purchaseOrders, (order) => [order.number, order.supplier?.name, order.supplierId, order.status, order.locationId, locations.find((location) => location.id === order.locationId)?.name]);
  const isAdmin = ['ADMIN', 'ADMIN_USER'].includes(role);
  const field = (key) => ({ value: newSupplier[key], onChange: (event) => setNewSupplier({ ...newSupplier, [key]: event.target.value }) });

  function move(order, action) {
    let note;
    if (action.to === 'CLOSED') {
      note = window.prompt(action.needsNote ? 'Why is this order being closed short? (required)' : 'Reason (needed only if no supplier invoice was matched)', '') ?? null;
      if (note === null) return;
    }
    changePurchaseOrderStatus(order, action.to, note || undefined);
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Card>
            <CardHeader><CardTitle className="text-base">Add supplier</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <Input {...field('name')} placeholder="Supplier name" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input type="email" {...field('email')} placeholder="Email (optional)" />
                <Input {...field('phone')} placeholder="Phone (optional)" />
                <Input {...field('contactName')} placeholder="Contact person" />
                <Input {...field('paymentTerms')} placeholder="Payment terms (e.g. Net 30)" />
                <Input inputMode="numeric" {...field('leadTimeDays')} placeholder="Lead time (days)" />
                <Input inputMode="decimal" {...field('moq')} placeholder="Minimum order qty" />
              </div>
              <Input {...field('categories')} placeholder="Brands / categories (comma separated)" />
              <Button onClick={createSupplier} disabled={submitLoading || !newSupplier.name.trim()}>Save supplier</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Create purchase order</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Select value={purchaseOrderForm.supplierId} onValueChange={(supplierId) => setPurchaseOrderForm({ ...purchaseOrderForm, supplierId })}>
                <SelectTrigger><SelectValue placeholder="Supplier" /></SelectTrigger>
                <SelectContent>{suppliers.filter((supplier) => !supplier.status || supplier.status === 'ACTIVE').map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}{supplier.leadTimeDays ? ` · ${supplier.leadTimeDays}d` : ''}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={purchaseOrderForm.locationId} onValueChange={(value) => setPurchaseOrderForm({ ...purchaseOrderForm, locationId: value })}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>{locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent>
              </Select>
              <ItemSearchSelect items={items} value={purchaseOrderForm.itemId} onChange={(itemId) => setPurchaseOrderForm({ ...purchaseOrderForm, itemId })} />
              <Input type="number" min="1" value={purchaseOrderForm.quantity} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, quantity: Number(event.target.value) })} placeholder="Quantity" />
              <Input type="number" min="0" value={purchaseOrderForm.unitCost} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, unitCost: Number(event.target.value) })} placeholder="Unit cost" />
              <Input type="date" value={purchaseOrderForm.expectedAt} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, expectedAt: event.target.value })} />
              <Textarea className="md:col-span-2" value={purchaseOrderForm.notes} onChange={(event) => setPurchaseOrderForm({ ...purchaseOrderForm, notes: event.target.value })} placeholder="Notes" />
              <Button className="md:col-span-2" onClick={createPurchaseOrder} disabled={submitLoading || !purchaseOrderForm.supplierId || !purchaseOrderForm.locationId || !purchaseOrderForm.itemId}>Create purchase order</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {isAdmin && <PurchasePlan locations={locations} suppliers={suppliers} plan={purchasePlan} loadPurchasePlan={loadPurchasePlan} draftFromPlan={draftFromPlan} submitLoading={submitLoading} />}

      <TableToolbar tableId="purchase-orders" userId={session?.user?.id} state={view.state} onChange={view.setState} defaults={DEFAULT_TABLE_STATE} searchLabel="Search purchase orders" />

      <Card>
        <CardHeader><CardTitle className="text-base">Purchase order register</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>PO number</TableHead><TableHead>Supplier</TableHead><TableHead>Destination</TableHead><TableHead>Expected</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {view.visible.length ? view.visible.map((order) => {
                const actions = poActions(role, order.status);
                const progress = receiptProgress(order);
                return (
                  <TableRow key={order.id} className={view.compact ? '[&_td]:py-1' : ''}>
                    <TableCell className="font-medium">{order.number}</TableCell>
                    <TableCell>{order.supplier?.name ?? order.supplierId}</TableCell>
                    <TableCell>{locations.find((location) => location.id === order.locationId)?.name ?? order.locationId}</TableCell>
                    <TableCell>{order.expectedAt ? new Date(order.expectedAt).toLocaleDateString('en-IN') : 'Not set'}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(order.status)}>{order.status.replaceAll('_', ' ')}</Badge>
                      {progress.received > 0 && <p className="mt-1 text-xs text-muted-foreground">{progress.received} of {progress.ordered} received ({progress.percent}%)</p>}
                    </TableCell>
                    <TableCell className="text-right">₹{Number(order.totalAmount ?? 0).toLocaleString('en-IN')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {actions.moves.map((action) => <Button key={action.to} size="sm" variant={action.tone === 'destructive' ? 'ghost' : 'outline'} disabled={submitLoading} onClick={() => move(order, action)}>{action.label}</Button>)}
                        {actions.receive && <Button size="sm" onClick={() => openPurchaseReceipt(order)}>Receive</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }) : <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted-foreground">No purchase orders created yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
